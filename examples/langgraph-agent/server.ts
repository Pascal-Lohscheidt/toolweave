/**
 * Tiny web app around the LangGraph agent: a chat UI that also shows the
 * TypeScript program the model wrote and what came back from the sandbox.
 *
 *   pnpm app   →  http://localhost:8787
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './agent';

const PORT = Number(process.env.PORT ?? 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ready = buildAgent();

interface Step {
  type: 'program' | 'tool_result' | 'reply';
  content: string;
}

function serializeNewMessages(messages: unknown[], previousCount: number): Step[] {
  const steps: Step[] = [];
  for (const raw of messages.slice(previousCount)) {
    const msg = raw as {
      getType?: () => string;
      _getType?: () => string;
      content?: unknown;
      tool_calls?: Array<{ name?: string; args?: { code?: string } }>;
    };
    const type = msg.getType?.() ?? msg._getType?.() ?? '';
    if (type === 'ai') {
      for (const call of msg.tool_calls ?? []) {
        if (call.args?.code) steps.push({ type: 'program', content: call.args.code });
      }
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? b.text : ''))
                .join('')
            : '';
      if (text.trim()) steps.push({ type: 'reply', content: text });
    } else if (type === 'tool') {
      steps.push({ type: 'tool_result', content: String(msg.content ?? '') });
    }
  }
  return steps;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const html = await readFile(path.join(HERE, 'public/index.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/chat') {
        const { messages } = JSON.parse(await readBody(req)) as {
          messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        };
        const { agent, runtime } = await ready;
        // Repair attempts are budgeted per user request, not per server lifetime.
        runtime.resetRepairs();
        const result = await agent.invoke({ messages });
        const steps = serializeNewMessages(result.messages as unknown[], messages.length);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ steps }));
        return;
      }
      res.writeHead(404).end('not found');
    } catch (error) {
      console.error(error);
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`toolweave × LangGraph demo → http://localhost:${PORT}`);
});
