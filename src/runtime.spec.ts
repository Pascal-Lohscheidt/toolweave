import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRuntime } from './runtime';
import { defineTool } from './tools/define';

const echo = defineTool({
  name: 'echo',
  description: 'Echo the message back',
  input: z.object({ message: z.string() }),
  output: z.string(),
  impl: async ({ message }) => message,
});

describe('createRuntime', () => {
  const runtime = createRuntime({
    tools: [echo],
    checker: 'in-process',
    maxRepairs: 2,
    limits: { timeoutMs: 5_000, memoryMb: 32 },
  });
  afterAll(() => runtime.dispose());

  it('exposes the generated declarations', () => {
    const decls = runtime.declarations();
    expect(decls).toContain('declare function echo(input: {');
    expect(decls).toContain('declare const console');
  });

  it('returns structured results with repair countdown', async () => {
    runtime.resetRepairs();
    const first = await runtime.execute('return await echo({ message: 42 });');
    expect(first).toMatchObject({ ok: false, phase: 'check', repairsRemaining: 1 });

    const second = await runtime.execute('return await echo({ message: 42 });');
    expect(second).toMatchObject({ ok: false, phase: 'check', repairsRemaining: 0 });

    // A passing program resets the counter.
    const ok = await runtime.execute("return await echo({ message: 'fixed' });");
    expect(ok).toMatchObject({ ok: true, value: 'fixed' });
    runtime.resetRepairs();
  });

  it('accepts custom Checker and Sandbox instances', async () => {
    const seen: string[] = [];
    const custom = createRuntime({
      tools: [echo],
      checker: {
        check: async (source) => {
          seen.push(source);
          return [];
        },
      },
      sandbox: {
        run: async () => 'stubbed',
      },
    });
    const result = await custom.execute('return 1;');
    expect(result).toMatchObject({ ok: true, value: 'stubbed' });
    expect(seen).toEqual(['return 1;']);
    await custom.dispose();
  });
});
