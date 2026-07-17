/**
 * CLI version of the LangGraph demo — one question, straight to stdout.
 * For the chat UI, run `pnpm app` instead.
 */
import { buildAgent } from './agent';

const { agent, runtime } = await buildAgent();

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content:
        'Which outdoor products under 90 euros are actually in stock? ' +
        'Answer with name, price, and units available, cheapest first.',
    },
  ],
});

const final = result.messages.at(-1);
console.log(final?.content);
await runtime.dispose();
