import { describe, expect, it } from 'vitest';
import { SandboxRuntimeError, SandboxTimeoutError } from '../errors';
import { QuickJSSandbox } from './quickjs';

const sandbox = new QuickJSSandbox();
const run = (js: string, bindings = {}, options = {}) => sandbox.run(js, bindings, options);

describe('QuickJSSandbox', () => {
  it('runs a program and returns its value', async () => {
    const value = await run('async function __main__() { return 1 + 2; }\n__main__();');
    expect(value).toBe(3);
  });

  it('calls async host bindings and marshals JSON values both ways', async () => {
    const calls: unknown[] = [];
    const value = await run(
      [
        'async function __main__() {',
        "  const a = await fetchItem({ id: 'x' });",
        '  const b = await fetchItem({ id: a.next });',
        '  return [a.id, b.id];',
        '}',
        '__main__();',
      ].join('\n'),
      {
        fetchItem: async (input: unknown) => {
          calls.push(input);
          const { id } = input as { id: string };
          return { id, next: `${id}+` };
        },
      },
    );
    expect(value).toEqual(['x', 'x+']);
    expect(calls).toEqual([{ id: 'x' }, { id: 'x+' }]);
  });

  it('runs many interleaved tool calls (pump ordering)', async () => {
    const value = await run(
      [
        'async function __main__() {',
        '  const results = [];',
        '  for (let i = 0; i < 5; i++) results.push(await double(i));',
        '  return results;',
        '}',
        '__main__();',
      ].join('\n'),
      { double: async (n: unknown) => (n as number) * 2 },
    );
    expect(value).toEqual([0, 2, 4, 6, 8]);
  });

  it('captures console output', async () => {
    const logs: string[] = [];
    await run(
      "async function __main__() { console.log('hello', { a: 1 }); return null; }\n__main__();",
      {},
      { onLog: (line: string) => logs.push(line) },
    );
    expect(logs).toEqual(['hello {"a":1}']);
  });

  it('propagates host binding rejections as guest exceptions', async () => {
    await expect(
      run('async function __main__() { return await boom(); }\n__main__();', {
        boom: async () => {
          throw new Error('kaputt');
        },
      }),
    ).rejects.toThrow(/kaputt/);
  });

  it('lets the guest catch host rejections', async () => {
    const value = await run(
      [
        'async function __main__() {',
        "  try { await boom(); return 'no'; } catch (e) { return e.message; }",
        '}',
        '__main__();',
      ].join('\n'),
      {
        boom: async () => {
          throw new Error('caught me');
        },
      },
    );
    expect(value).toBe('caught me');
  });

  it('reports uncaught guest errors with a stack line', async () => {
    const error = await run(
      "async function __main__() {\nconst x = 1;\nthrow new Error('boom');\n}\n__main__();",
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SandboxRuntimeError);
    expect((error as SandboxRuntimeError).message).toBe('boom');
    expect((error as SandboxRuntimeError).line).toBe(3);
  });

  it('interrupts infinite loops', async () => {
    await expect(
      run(
        'async function __main__() { while (true) {} }\n__main__();',
        {},
        {
          limits: { timeoutMs: 200, memoryMb: 64 },
        },
      ),
    ).rejects.toThrow(SandboxTimeoutError);
  }, 10_000);

  it('times out on a never-resolving tool call', async () => {
    await expect(
      run(
        'async function __main__() { return await never(); }\n__main__();',
        {
          never: () => new Promise(() => {}),
        },
        { limits: { timeoutMs: 200, memoryMb: 64 } },
      ),
    ).rejects.toThrow(SandboxTimeoutError);
  }, 10_000);

  it('rejects programs over the memory limit', async () => {
    await expect(
      run(
        'async function __main__() { const a = []; while (true) a.push(new Array(65536).fill(1)); }\n__main__();',
        {},
        { limits: { timeoutMs: 5_000, memoryMb: 8 } },
      ),
    ).rejects.toThrow(/memory|time/i);
  }, 10_000);
});
