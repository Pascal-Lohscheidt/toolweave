import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRuntime } from '../runtime';
import { defineTool } from '../tools/define';
import { asTool } from './descriptor';

const echo = defineTool({
  name: 'echo',
  description: 'Echo the message back',
  input: z.object({ message: z.string() }),
  output: z.string(),
  impl: async ({ message }) => message,
});

describe('asTool', () => {
  const runtime = createRuntime({
    tools: [echo],
    checker: 'in-process',
    maxRepairs: 2,
    limits: { timeoutMs: 5_000, memoryMb: 32 },
  });
  const tool = asTool(runtime);
  afterAll(() => runtime.dispose());

  beforeAll(async () => {
    await runtime.execute('return 1;');
  });

  it('describes itself with the declarations and program rules', () => {
    expect(tool.name).toBe('execute_typescript');
    expect(tool.description).toContain('declare function echo');
    expect(tool.description).toContain('return');
    expect(tool.inputJsonSchema).toMatchObject({ type: 'object', required: ['code'] });
  });

  it('renders success results with value and logs', async () => {
    const text = await tool.execute({
      code: "console.log('hi');\nreturn await echo({ message: 'pong' });",
    });
    expect(text).toContain('Result:\n"pong"');
    expect(text).toContain('Logs:\nhi');
  });

  it('renders diagnostics with a countdown, then the stop instruction', async () => {
    runtime.resetRepairs();
    const first = await tool.execute({ code: 'return await echo({ message: 42 });' });
    expect(first).toContain('Type errors:');
    expect(first).toMatch(/line 1, col \d+: TS\d+/);
    expect(first).toContain('1 repair attempt remaining.');

    const second = await tool.execute({ code: 'return await echo({ message: 42 });' });
    expect(second).toContain('Do not retry; report the problem to the user instead.');

    // A passing program resets the counter.
    const ok = await tool.execute({ code: "return await echo({ message: 'fixed' });" });
    expect(ok).toContain('Result:');
    runtime.resetRepairs();
  });

  it('renders runtime errors with the failing line', async () => {
    const text = await tool.execute({
      code: "const x: string = 'a';\nthrow new Error('deliberate');",
    });
    expect(text).toContain('Runtime error (line 2): Error: deliberate');
  });

  it('renders limit results', async () => {
    const fast = createRuntime({
      tools: [echo],
      checker: 'none',
      limits: { timeoutMs: 150, memoryMb: 32 },
    });
    const text = await asTool(fast).execute({ code: 'while (true) {}' });
    expect(text).toContain('exceeded its timeout limit');
    await fast.dispose();
  }, 10_000);
});
