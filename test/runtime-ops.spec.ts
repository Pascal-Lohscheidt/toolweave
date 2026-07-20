import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRuntime, defineTool } from '../src/index';
import type { ChildProcess } from 'node:child_process';
import { TsgoChecker } from '../src/checker/tsgo';

const noop = defineTool({
  name: 'noop',
  description: 'Do nothing',
  input: z.object({}),
  output: z.null(),
  impl: async () => null,
});

const slow = defineTool({
  name: 'slow',
  description: 'Never finishes',
  input: z.object({}),
  output: z.null(),
  impl: () => new Promise<null>(() => {}),
});

describe('limits', () => {
  const runtime = createRuntime({
    tools: [noop, slow],
    checker: 'none',
    limits: { timeoutMs: 300, memoryMb: 8 },
  });
  afterAll(() => runtime.dispose());

  it('interrupts a busy loop within ~2x the budget', async () => {
    const start = Date.now();
    const result = await runtime.execute('while (true) {}');
    const elapsed = Date.now() - start;
    expect(result).toMatchObject({ ok: false, phase: 'limit', kind: 'timeout' });
    expect(elapsed).toBeLessThan(300 * 2 + 250);
  }, 10_000);

  it('times out a hung tool call within ~2x the budget', async () => {
    const start = Date.now();
    const result = await runtime.execute('await slow({});\nreturn null;');
    const elapsed = Date.now() - start;
    expect(result).toMatchObject({ ok: false, phase: 'limit', kind: 'timeout' });
    expect(elapsed).toBeLessThan(300 * 2 + 250);
  }, 10_000);

  it('caps memory', async () => {
    const result = await runtime.execute(
      'const a: unknown[] = [];\nwhile (true) a.push(new Array(65536).fill(1));',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase === 'limit' || result.phase === 'runtime').toBe(true);
  }, 10_000);

  it('caps guest stack depth', async () => {
    const result = await runtime.execute(
      'function recurse(n: number): number { return recurse(n + 1); }\nreturn recurse(0);',
    );
    expect(result).toMatchObject({ ok: false, phase: 'limit', kind: 'stack' });
  }, 10_000);
});

describe('concurrency', () => {
  it('handles 10 parallel execute() calls on one runtime', async () => {
    const runtime = createRuntime({
      tools: [noop],
      checker: 'in-process',
      limits: { timeoutMs: 5_000, memoryMb: 32 },
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => runtime.execute(`await noop({});\nreturn ${i};`)),
    );
    results.forEach((result, i) => {
      expect(result).toMatchObject({ ok: true, value: i });
    });
    await runtime.dispose();
  }, 30_000);

  it('serializes parallel checks on the tsgo backend', async () => {
    const checker = new TsgoChecker();
    const decls = 'declare function ping(input: { n: number }): Promise<number>;';
    try {
      const results = await Promise.all([
        checker.check('return await ping({ n: 1 });', decls),
        checker.check('return await ping({ n: "x" });', decls),
        checker.check('return await ping({ n: 3 });', decls),
        checker.check('return nope();', decls),
      ]);
      expect(results[0]).toEqual([]);
      expect(results[1]!.length).toBeGreaterThan(0);
      expect(results[2]).toEqual([]);
      expect(results[3]!.length).toBeGreaterThan(0);
    } finally {
      await checker.dispose();
    }
  }, 30_000);
});

describe('disposal', () => {
  it('dispose is idempotent and blocks further checks', async () => {
    const checker = new TsgoChecker();
    const decls = 'declare function f(): Promise<void>;';
    await checker.check('return null;', decls);
    await checker.dispose();
    await checker.dispose();
    await expect(checker.check('return null;', decls)).rejects.toThrow(/disposed/);
  }, 20_000);

  it('tsgo restarts after its process is killed mid-session', async () => {
    const checker = new TsgoChecker();
    const decls = 'declare function f(): Promise<void>;';
    expect(await checker.check('return null;', decls)).toEqual([]);

    // Reach into the live session and kill the subprocess.
    const session = await (checker as unknown as { session: Promise<{ child: ChildProcess }> })
      .session;
    session.child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));

    // Next check must respawn transparently.
    expect(await checker.check('return null;', decls)).toEqual([]);
    await checker.dispose();
  }, 30_000);
});
