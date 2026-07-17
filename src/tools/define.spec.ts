import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolDefinitionError } from '../errors';
import { defineTool } from './define';

const base = {
  description: 'Adds two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.number(),
  impl: async ({ a, b }: { a: number; b: number }) => a + b,
};

describe('defineTool', () => {
  it('returns the config branded as a tool', () => {
    const tool = defineTool({ name: 'add', ...base });
    expect(tool.kind).toBe('toolweave.tool');
    expect(tool.name).toBe('add');
    expect(tool.description).toBe('Adds two numbers');
  });

  it('accepts valid identifier names', () => {
    for (const name of ['searchDocs', '_private', '$dollar', 'a1']) {
      expect(() => defineTool({ ...base, name })).not.toThrow();
    }
  });

  it('rejects names that are not JS identifiers', () => {
    for (const name of ['search-docs', '1st', 'a b', '', 'ab.cd']) {
      expect(() => defineTool({ ...base, name })).toThrow(ToolDefinitionError);
    }
  });

  it('rejects reserved words and injected globals', () => {
    for (const name of ['return', 'await', 'console', '__main__', 'eval']) {
      expect(() => defineTool({ ...base, name })).toThrow(ToolDefinitionError);
    }
  });

  it('rejects empty descriptions', () => {
    expect(() => defineTool({ ...base, name: 'add', description: '  ' })).toThrow(
      ToolDefinitionError,
    );
  });
});
