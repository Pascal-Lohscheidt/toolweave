/**
 * The demo capability: a tiny product catalog behind two toolweave tools.
 * The agent composes them in ONE typed TypeScript program instead of a
 * round-trip per call.
 */
import { z } from 'zod';
import { createRuntime, defineTool } from 'toolweave';

const catalog = [
  { id: 'p1', name: 'Trail Backpack 30L', price: 89, category: 'outdoor' },
  { id: 'p2', name: 'Titanium Mug', price: 24, category: 'outdoor' },
  { id: 'p3', name: 'Merino Hoodie', price: 120, category: 'apparel' },
  { id: 'p4', name: 'Headlamp Pro', price: 45, category: 'outdoor' },
  { id: 'p5', name: 'Rain Shell', price: 99, category: 'apparel' },
  { id: 'p6', name: 'Trekking Poles', price: 59, category: 'outdoor' },
];

const stock = new Map([
  ['p1', 3],
  ['p2', 0],
  ['p3', 12],
  ['p4', 7],
  ['p5', 0],
  ['p6', 5],
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

export function createDemoRuntime() {
  return createRuntime({
    tools: [searchProducts, getStock],
    checker: 'tsgo',
    maxRepairs: 2,
    limits: { timeoutMs: 5_000, memoryMb: 32 },
  });
}
