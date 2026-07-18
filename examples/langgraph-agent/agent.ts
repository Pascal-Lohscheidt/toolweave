import 'dotenv/config';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { asLangGraphTool } from 'toolweave/adapters/langgraph';
import { createDemoRuntime } from './tools';

/** Pick a chat model from whichever API key is configured. */
async function pickModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({ model: process.env.DEMO_MODEL ?? 'claude-sonnet-5' });
  }
  if (process.env.OPENAI_API_KEY) {
    const { ChatOpenAI } = await import('@langchain/openai');
    return new ChatOpenAI({ model: process.env.DEMO_MODEL ?? 'gpt-4o-mini' });
  }
  throw new Error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY (see .env.example).');
}

export async function buildAgent() {
  const runtime = createDemoRuntime();
  const agent = createReactAgent({
    llm: await pickModel(),
    tools: [asLangGraphTool(runtime)],
    prompt:
      'You are the assistant of a small outdoor shop. Answer every data question by writing a ' +
      'TypeScript program for the execute_typescript tool. Always fetch data through the ' +
      'declared tool functions — never answer from memory or hardcode data you saw in earlier ' +
      'turns, since stock, orders, and prices change. When building multi-line strings, use ' +
      'template literals, never quoted strings with raw line breaks.',
  });
  return { agent, runtime };
}
