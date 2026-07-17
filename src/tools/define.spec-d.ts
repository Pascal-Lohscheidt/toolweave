import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define';

describe('defineTool type inference', () => {
  it('types impl input from the input schema, with defaults applied', () => {
    defineTool({
      name: 'searchDocs',
      description: 'search',
      input: z.object({ query: z.string(), limit: z.number().default(5) }),
      output: z.array(z.object({ id: z.string() })),
      impl: async (input) => {
        // .default() means the parsed input always carries the property.
        expectTypeOf(input).toEqualTypeOf<{ query: string; limit: number }>();
        return [{ id: input.query }];
      },
    });
  });

  it('requires impl to return the output schema type', () => {
    defineTool({
      name: 'count',
      description: 'count',
      input: z.object({}),
      output: z.number(),
      // @ts-expect-error - string is not assignable to the number output schema
      impl: async () => 'not a number',
    });
  });

  it('allows sync impls', () => {
    const tool = defineTool({
      name: 'now',
      description: 'now',
      input: z.object({}),
      output: z.number(),
      impl: () => 42,
    });
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });
});
