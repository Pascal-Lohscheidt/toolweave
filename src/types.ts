/**
 * A single problem found while type-checking a generated program.
 * Line and column are 1-based and refer to the model's original source
 * (wrapper offsets are already subtracted by the checker).
 */
export interface Diagnostic {
  message: string;
  line: number;
  column: number;
  /** TypeScript error code, e.g. 2345 for TS2345. 0 when the backend has none. */
  code: number;
  severity: 'error' | 'warning';
}

/**
 * A type-check backend. Implementations must be warm-reusable: one instance
 * is created per runtime and `check` is called once per generated program.
 */
export interface Checker {
  /** Type-check `source` (raw model code, unwrapped) against the tool declarations. */
  check(source: string, decls: string): Promise<Diagnostic[]>;
  dispose?(): Promise<void>;
}

/** An async host function exposed to the sandboxed program. */
export type SandboxBinding = (...args: unknown[]) => Promise<unknown>;

export interface SandboxLimits {
  /** Wall-clock budget for the whole program run, including awaited tool calls. */
  timeoutMs: number;
  /** Hard cap on guest heap memory. */
  memoryMb: number;
}

export interface SandboxRunOptions {
  limits?: SandboxLimits;
  /** Receives each console.log/error line emitted by the guest. */
  onLog?: (line: string) => void;
}

/**
 * An execution backend for the transpiled program. `run` resolves with the
 * program's return value or rejects with a SandboxError subclass.
 */
export interface Sandbox {
  run(
    js: string,
    bindings: Record<string, SandboxBinding>,
    options?: SandboxRunOptions,
  ): Promise<unknown>;
  dispose?(): Promise<void>;
}

/** Structured outcome of `runtime.execute()`. Discriminate on `ok`, then `phase`. */
export type ExecutionResult =
  | { ok: true; value: unknown; logs: string[] }
  | { ok: false; phase: 'check'; diagnostics: Diagnostic[]; repairsRemaining: number }
  | {
      ok: false;
      phase: 'runtime';
      error: { name: string; message: string; line?: number; guestStack?: string };
      logs: string[];
    }
  | { ok: false; phase: 'limit'; kind: 'timeout' | 'memory' | 'stack'; logs: string[] };

export type CheckerKind = 'tsgo' | 'in-process' | 'none';
export type SandboxKind = 'quickjs';
