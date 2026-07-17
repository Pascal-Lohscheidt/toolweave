import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSSyncVariant,
  QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import {
  SandboxError,
  SandboxMemoryError,
  SandboxRuntimeError,
  SandboxStackError,
  SandboxTimeoutError,
} from '../errors';
import type { Sandbox, SandboxBinding, SandboxLimits, SandboxRunOptions } from '../types';
import { errorToHandle, formatLogLine, marshalToHandle } from './marshal';

const DEFAULT_LIMITS: SandboxLimits = { timeoutMs: 10_000, memoryMb: 64 };

// The wasm module is immutable after load; share it process-wide per variant.
const moduleCache = new Map<QuickJSSyncVariant, Promise<QuickJSWASMModule>>();

async function loadModule(variant?: QuickJSSyncVariant): Promise<QuickJSWASMModule> {
  const resolved =
    variant ??
    ((await import('@jitl/quickjs-singlefile-mjs-release-sync')).default as QuickJSSyncVariant);
  let cached = moduleCache.get(resolved);
  if (cached === undefined) {
    cached = newQuickJSWASMModuleFromVariant(resolved);
    moduleCache.set(resolved, cached);
  }
  return cached;
}

export interface QuickJSSandboxOptions {
  /** Override the wasm variant, e.g. the debug-sync build in leak tests. */
  variant?: QuickJSSyncVariant;
  defaultLimits?: Partial<SandboxLimits>;
}

/**
 * Default sandbox: QuickJS compiled to wasm (sync build, base64-embedded).
 *
 * Every run gets a fresh runtime + context — model programs are untrusted
 * and context creation costs ~1ms. Async tool calls work on the sync build
 * by handing the guest a QuickJS promise that the host settles, then
 * pumping `executePendingJobs()` after every settlement.
 */
export class QuickJSSandbox implements Sandbox {
  private readonly variant: QuickJSSyncVariant | undefined;
  private readonly defaults: SandboxLimits;

  constructor(options: QuickJSSandboxOptions = {}) {
    this.variant = options.variant;
    this.defaults = { ...DEFAULT_LIMITS, ...options.defaultLimits };
  }

  async run(
    js: string,
    bindings: Record<string, SandboxBinding>,
    options?: SandboxRunOptions,
  ): Promise<unknown> {
    const module = await loadModule(this.variant);
    const limits = { ...this.defaults, ...options?.limits };

    const runtime = module.newRuntime();
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(1_000_000);
    const deadline = Date.now() + limits.timeoutMs;
    let interrupted = false;
    runtime.setInterruptHandler(() => {
      if (Date.now() > deadline) {
        interrupted = true;
        return true;
      }
      return false;
    });

    const context = runtime.newContext();
    // Once false, late-settling host promises must not touch the context.
    let alive = true;
    // Host-side deferreds not yet settled; they must be settled or disposed
    // before the context is, or QuickJS aborts on leaked capability handles.
    const pending = new Set<QuickJSDeferredPromise>();
    let settled: Promise<SettledResult> | undefined;
    let settledConsumed = false;

    try {
      this.installConsole(context, options?.onLog);
      for (const [name, fn] of Object.entries(bindings)) {
        this.installBinding(context, name, fn, () => alive, pending);
      }

      const evalResult = context.evalCode(js, 'program.js');
      if ('error' in evalResult && evalResult.error !== undefined) {
        throw this.toSandboxError(context, evalResult.error, interrupted);
      }
      const promiseHandle = context.unwrapResult(evalResult);
      settled = context.resolvePromise(promiseHandle);
      promiseHandle.dispose();
      runtime.executePendingJobs();

      const outcome = await Promise.race([settled, deadlinePromise(deadline)]);
      if (outcome === TIMED_OUT) {
        interrupted = true;
        throw new SandboxTimeoutError(
          `Program exceeded the ${limits.timeoutMs}ms time budget while awaiting a tool call.`,
        );
      }
      settledConsumed = true;
      if ('error' in outcome && outcome.error !== undefined) {
        throw this.toSandboxError(context, outcome.error, interrupted);
      }
      const valueHandle = context.unwrapResult(outcome);
      const value = context.dump(valueHandle);
      valueHandle.dispose();
      return value;
    } finally {
      // Cancel outstanding host calls so the guest promise graph settles and
      // frees its handles. Guest catch-handlers may issue new calls, hence
      // the bounded loop.
      for (let round = 0; round < 10 && pending.size > 0; round++) {
        for (const deferred of [...pending]) {
          pending.delete(deferred);
          try {
            errorToHandle(context, new SandboxTimeoutError('Execution cancelled.')).consume((h) =>
              deferred.reject(h),
            );
          } catch {
            try {
              deferred.dispose();
            } catch {
              // Already freed by a racing settlement.
            }
          }
        }
        try {
          runtime.executePendingJobs();
        } catch {
          break;
        }
      }
      // The resolvePromise result owns a handle; if this run never consumed
      // it (timeout path), drain and dispose it or the runtime leaks.
      if (settled !== undefined && !settledConsumed) {
        const drained = await Promise.race([
          settled,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20)),
        ]);
        if (drained !== undefined) {
          const handle = 'error' in drained ? drained.error : drained.value;
          try {
            handle?.dispose();
          } catch {
            // Already freed.
          }
        }
      }
      alive = false;
      context.dispose();
      runtime.dispose();
    }
  }

  private installConsole(context: QuickJSContext, onLog?: (line: string) => void): void {
    const consoleHandle = context.newObject();
    for (const method of ['log', 'warn', 'error'] as const) {
      context
        .newFunction(method, (...argHandles) => {
          const args = argHandles.map((h) => context.dump(h));
          onLog?.(formatLogLine(args));
          return context.undefined;
        })
        .consume((fn) => context.setProp(consoleHandle, method, fn));
    }
    consoleHandle.consume((c) => context.setProp(context.global, 'console', c));
  }

  private installBinding(
    context: QuickJSContext,
    name: string,
    fn: SandboxBinding,
    isAlive: () => boolean,
    pending: Set<QuickJSDeferredPromise>,
  ): void {
    context
      .newFunction(name, (...argHandles) => {
        const args = argHandles.map((h) => context.dump(h));
        const deferred = context.newPromise();
        pending.add(deferred);
        fn(...args).then(
          (value) => {
            if (!isAlive() || !pending.has(deferred)) return;
            marshalToHandle(context, value).consume((h) => deferred.resolve(h));
          },
          (error: unknown) => {
            if (!isAlive() || !pending.has(deferred)) return;
            errorToHandle(context, error).consume((h) => deferred.reject(h));
          },
        );
        deferred.settled.then(() => {
          pending.delete(deferred);
          if (isAlive()) context.runtime.executePendingJobs();
        });
        return deferred.handle;
      })
      .consume((f) => context.setProp(context.global, name, f));
  }

  private toSandboxError(
    context: QuickJSContext,
    errorHandle: Parameters<QuickJSContext['dump']>[0],
    interrupted: boolean,
  ): SandboxError {
    const dumped: unknown = context.dump(errorHandle);
    errorHandle.dispose();
    const err =
      typeof dumped === 'object' && dumped !== null
        ? (dumped as { name?: string; message?: string; stack?: string })
        : { name: 'Error', message: String(dumped) };
    const message = err.message ?? 'Unknown guest error';

    if (interrupted || /interrupted/i.test(message)) {
      return new SandboxTimeoutError('Program exceeded its time budget and was interrupted.');
    }
    if (/out of memory/i.test(message) || err.name === 'InternalError') {
      return new SandboxMemoryError('Program exceeded its memory limit.');
    }
    if (/stack overflow/i.test(message)) {
      return new SandboxStackError('Program exceeded the guest stack size.');
    }
    return new SandboxRuntimeError(
      message,
      err.name ?? 'Error',
      err.stack,
      parseGuestLine(err.stack),
    );
  }
}

type SettledResult = Awaited<ReturnType<QuickJSContext['resolvePromise']>>;

const TIMED_OUT = Symbol('timeout');

function deadlinePromise(deadline: number): Promise<typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, deadline - Date.now()) + 50);
    // Never keep the host process alive just for a sandbox deadline.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

/** First program.js line in a guest stack, in wrapped-program coordinates. */
function parseGuestLine(stack: string | undefined): number | undefined {
  const match = stack?.match(/program\.js:(\d+)/);
  return match ? Number(match[1]) : undefined;
}
