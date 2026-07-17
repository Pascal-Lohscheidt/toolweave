import { describe, expect, it } from 'vitest';
import type { QuickJSSyncVariant } from 'quickjs-emscripten-core';
import debugVariant from '@jitl/quickjs-singlefile-mjs-debug-sync';
import { SandboxRuntimeError, SandboxTimeoutError } from '../src/errors';
import { QuickJSSandbox } from '../src/sandbox/quickjs';

// The debug wasm build asserts on leaked handles and GC objects at dispose
// time, so simply completing each scenario without an abort IS the assertion.
const sandbox = new QuickJSSandbox({ variant: debugVariant as QuickJSSyncVariant });

describe('handle-leak checks (debug variant)', () => {
  it('leaks nothing on the success path', async () => {
    const value = await sandbox.run(
      'async function __main__() { return await add({ a: 1, b: 2 }); }\n__main__();',
      {
        add: async (input: unknown) =>
          (input as { a: number; b: number }).a + (input as { a: number; b: number }).b,
      },
    );
    expect(value).toBe(3);
  });

  it('leaks nothing on the guest-error path', async () => {
    await expect(
      sandbox.run("async function __main__() { throw new Error('x'); }\n__main__();", {}),
    ).rejects.toThrow(SandboxRuntimeError);
  });

  it('leaks nothing on the timeout path with a pending tool call', async () => {
    await expect(
      sandbox.run(
        'async function __main__() { return await never(); }\n__main__();',
        { never: () => new Promise(() => {}) },
        { limits: { timeoutMs: 150, memoryMb: 64 } },
      ),
    ).rejects.toThrow(SandboxTimeoutError);
  }, 10_000);

  it('leaks nothing across repeated runs', async () => {
    for (let i = 0; i < 5; i++) {
      const value = await sandbox.run(
        `async function __main__() { return ${i}; }\n__main__();`,
        {},
      );
      expect(value).toBe(i);
    }
  });
});
