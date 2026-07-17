import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolDefinitionError } from '../errors';
import { defineTool } from './define';
import { generateDeclarations } from './codegen';

const searchDocs = defineTool({
  name: 'searchDocs',
  description: 'Full-text search over the knowledge base',
  input: z.object({
    query: z.string().describe('The search query'),
    limit: z.number().default(5),
  }),
  output: z.array(z.object({ id: z.string(), text: z.string() })),
  impl: async () => [],
});

describe('generateDeclarations', () => {
  it('renders a full declaration with JSDoc, optional-from-default, and Promise return', () => {
    const decls = generateDeclarations([searchDocs]);
    expect(decls).toContain('/** Full-text search over the knowledge base */');
    expect(decls).toContain('declare function searchDocs(input: {');
    expect(decls).toContain('/** The search query */');
    expect(decls).toContain('query: string;');
    expect(decls).toContain('/** @default 5 */');
    expect(decls).toContain('limit?: number;');
    expect(decls).toContain('}): Promise<{\n  id: string;\n  text: string;\n}[]>;');
  });

  it('declares the console prelude once at the top', () => {
    const decls = generateDeclarations([searchDocs]);
    expect(decls.startsWith('declare const console: {')).toBe(true);
    expect(decls).toContain('log(...args: unknown[]): void;');
  });

  it('marks the whole input optional when no property is required', () => {
    const tool = defineTool({
      name: 'listAll',
      description: 'List everything',
      input: z.object({ limit: z.number().optional() }),
      output: z.array(z.string()),
      impl: async () => [],
    });
    expect(generateDeclarations([tool])).toContain('declare function listAll(input?: {');
  });

  it('renders enums, literals, unions, nullables, tuples, and records', () => {
    const tool = defineTool({
      name: 'kitchenSink',
      description: 'Everything at once',
      input: z.object({
        mode: z.enum(['fast', 'slow']),
        tag: z.literal('x'),
        idOrIndex: z.union([z.string(), z.number()]),
        maybe: z.string().nullable(),
        pair: z.tuple([z.string(), z.number()]),
        counts: z.record(z.string(), z.number()),
        anything: z.unknown(),
      }),
      output: z.boolean(),
      impl: async () => true,
    });
    const decls = generateDeclarations([tool]);
    expect(decls).toContain("mode: 'fast' | 'slow';");
    expect(decls).toContain("tag: 'x';");
    expect(decls).toContain('idOrIndex: string | number;');
    expect(decls).toContain('maybe: string | null;');
    expect(decls).toContain('pair: [string, number];');
    expect(decls).toContain('counts: Record<string, number>;');
    expect(decls).toContain('anything: unknown;');
  });

  it('parenthesizes union item types inside arrays', () => {
    const tool = defineTool({
      name: 'mixed',
      description: 'Mixed list',
      input: z.object({ items: z.array(z.union([z.string(), z.number()])) }),
      output: z.null(),
      impl: async () => null,
    });
    expect(generateDeclarations([tool])).toContain('items: (string | number)[];');
  });

  it('quotes non-identifier property keys', () => {
    const tool = defineTool({
      name: 'weird',
      description: 'Weird keys',
      input: z.object({ 'content-type': z.string() }),
      output: z.null(),
      impl: async () => null,
    });
    expect(generateDeclarations([tool])).toContain('"content-type": string;');
  });

  it('rejects duplicate tool names', () => {
    expect(() => generateDeclarations([searchDocs, searchDocs])).toThrow(ToolDefinitionError);
  });

  it('rejects schemas that cannot be represented in JSON', () => {
    const tool = defineTool({
      name: 'bad',
      description: 'Has a date',
      input: z.object({ when: z.date() }),
      output: z.null(),
      impl: async () => null,
    });
    expect(() => generateDeclarations([tool])).toThrow(ToolDefinitionError);
    expect(() => generateDeclarations([tool])).toThrow(/bad/);
  });

  it('matches the full snapshot for a representative toolset', () => {
    const getWeather = defineTool({
      name: 'getWeather',
      description: 'Get current weather for a city.\nUses the nearest station.',
      input: z.object({
        city: z.string().describe('City name'),
        unit: z.enum(['c', 'f']).default('c'),
      }),
      output: z.object({ tempC: z.number(), description: z.string() }),
      impl: async () => ({ tempC: 20, description: 'sunny' }),
    });
    expect(generateDeclarations([getWeather, searchDocs])).toMatchSnapshot();
  });
});
