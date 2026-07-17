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
  });
  return { agent, runtime };
}
