import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRuntime } from '../runtime';
import { defineTool } from '../tools/define';
import { asLangGraphTool } from './langgraph';

const add = defineTool({
  name: 'add',
  description: 'Add two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.number(),
  impl: async ({ a, b }) => a + b,
});

const runtime = createRuntime({ tools: [add], checker: 'in-process' });
afterAll(() => runtime.dispose());

describe('asLangGraphTool', () => {
  const lcTool = asLangGraphTool(runtime);

  beforeAll(async () => {
    await runtime.execute('return 1;');
  });

  it('produces a structured tool with the toolweave contract', () => {
    expect(lcTool.name).toBe('execute_typescript');
    expect(lcTool.description).toContain('declare function add');
    // LangChain marks structured tools via this discriminator.
    expect(typeof lcTool.invoke).toBe('function');
  });

  it('executes a program through the LangChain invoke path (no LLM involved)', async () => {
    const result = await lcTool.invoke({ code: 'return await add({ a: 2, b: 3 });' });
    expect(result).toContain('Result:\n5');
  });

  it('feeds diagnostics back through the tool result', async () => {
    runtime.resetRepairs();
    const result = await lcTool.invoke({ code: "return await add({ a: 'x', b: 3 });" });
    expect(result).toContain('Type errors:');
    runtime.resetRepairs();
  });
});
