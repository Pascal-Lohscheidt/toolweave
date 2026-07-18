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
        'Anna (anna@example.com) wants every in-stock product under 100 euros with an average ' +
        'review rating of at least 4. For the cheapest match, how much would shipping to her ' +
        'address cost, and what is the total in CHF?',
    },
  ],
});

const final = result.messages.at(-1);
console.log(final?.content);
await runtime.dispose();
