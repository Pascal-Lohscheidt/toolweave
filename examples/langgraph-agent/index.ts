/**
 * LangGraph agent with toolweave's execute_typescript tool.
 *
 * The agent gets ONE tool. Instead of a round-trip per tool call, the model
 * writes a typed TypeScript program that composes searchProducts/getStock,
 * toolweave type-checks it (feeding errors back through the normal tool
 * loop), and runs it sandboxed — only the final result reaches the model.
 *
 * Requires ANTHROPIC_API_KEY.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { createRuntime, defineTool } from 'toolweave';
import { asLangGraphTool } from 'toolweave/adapters/langgraph';

const catalog = [
  { id: 'p1', name: 'Trail Backpack 30L', price: 89, category: 'outdoor' },
  { id: 'p2', name: 'Titanium Mug', price: 24, category: 'outdoor' },
  { id: 'p3', name: 'Merino Hoodie', price: 120, category: 'apparel' },
  { id: 'p4', name: 'Headlamp Pro', price: 45, category: 'outdoor' },
];
const stock = new Map([
  ['p1', 3],
  ['p2', 0],
  ['p3', 12],
  ['p4', 7],
]);

const searchProducts = defineTool({
  name: 'searchProducts',
  description: 'Search the product catalog by category',
  input: z.object({ category: z.enum(['outdoor', 'apparel']) }),
  output: z.array(z.object({ id: z.string(), name: z.string(), price: z.number() })),
  impl: async ({ category }) => catalog.filter((p) => p.category === category),
});

const getStock = defineTool({
  name: 'getStock',
  description: 'Get the units in stock for a product id',
  input: z.object({ id: z.string() }),
  output: z.number(),
  impl: async ({ id }) => stock.get(id) ?? 0,
});

const runtime = createRuntime({
  tools: [searchProducts, getStock],
  checker: 'in-process',
  maxRepairs: 2,
});

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-sonnet-5' }),
  tools: [asLangGraphTool(runtime)],
});

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
