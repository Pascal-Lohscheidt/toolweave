import { z } from 'zod';
import {
  SandboxMemoryError,
  SandboxRuntimeError,
  SandboxStackError,
  SandboxTimeoutError,
  ToolCallError,
} from './errors';
import { EXECUTE_SUFFIX, wrapProgram } from './program/wrap';
import { QuickJSSandbox } from './sandbox/quickjs';
import { FallbackChecker } from './checker/fallback';
import { InProcessChecker } from './checker/inprocess';
import { NoneChecker } from './checker/none';
import { TsgoChecker } from './checker/tsgo';
import { generateDeclarations } from './tools/codegen';
import type { AnyTool } from './tools/define';
import { stripTypes } from './transpile';
import type {
  Checker,
  CheckerKind,
  ExecutionResult,
  Sandbox,
  SandboxBinding,
  SandboxKind,
  SandboxLimits,
} from './types';

export interface RuntimeOptions {
  tools: AnyTool[];
  /**
   * Type-check backend, routeable without touching agent code:
   * 'tsgo' (native, fastest), 'in-process' (typescript peer), 'none'
   * (trust the model), or any custom Checker instance.
   * @default 'tsgo' with automatic fallback to 'in-process'
   */
  checker?: CheckerKind | Checker;
  /** @default 'quickjs' */
  sandbox?: SandboxKind | Sandbox;
  /** How many check-failure round-trips asTool() invites before telling the model to stop. */
  maxRepairs?: number;
  limits?: Partial<SandboxLimits>;
}

export interface ExecuteTypescriptToolDescriptor {
  name: 'execute_typescript';
  description: string;
  inputSchema: z.ZodType<{ code: string }>;
  inputJsonSchema: Record<string, unknown>;
  execute(input: { code: string }): Promise<string>;
}

export interface ToolweaveRuntime {
  /** The generated tool declarations — hand this to the model in its prompt. */
  declarations(): string;
  /** Check → transpile → run one generated program. Never calls an LLM. */
  execute(code: string): Promise<ExecutionResult>;
  /** The whole loop packaged as one framework-agnostic tool. */
  asTool(): ExecuteTypescriptToolDescriptor;
  /** Reset the repair counter, e.g. when a new conversation starts. */
  resetRepairs(): void;
  dispose(): Promise<void>;
}

const DEFAULT_LIMITS: SandboxLimits = { timeoutMs: 10_000, memoryMb: 64 };

export function createRuntime(options: RuntimeOptions): ToolweaveRuntime {
  const decls = generateDeclarations(options.tools);
  const checker = resolveChecker(options.checker ?? 'tsgo');
  const sandbox = resolveSandbox(options.sandbox ?? 'quickjs');
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const maxRepairs = options.maxRepairs ?? 2;
  const bindings = buildBindings(options.tools);
  let repairAttempts = 0;

  async function execute(code: string): Promise<ExecutionResult> {
    const diagnostics = await checker.check(code, decls);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      repairAttempts++;
      return {
        ok: false,
        phase: 'check',
        diagnostics,
        repairsRemaining: Math.max(0, maxRepairs - repairAttempts),
      };
    }
    repairAttempts = 0;

    const wrapped = wrapProgram(code);
    const js = stripTypes(wrapped.text) + EXECUTE_SUFFIX;
    const logs: string[] = [];
    try {
      const value = await sandbox.run(js, bindings, {
        limits,
        onLog: (line) => logs.push(line),
      });
      return { ok: true, value, logs };
    } catch (error) {
      const limitKind =
        error instanceof SandboxTimeoutError
          ? 'timeout'
          : error instanceof SandboxMemoryError
            ? 'memory'
            : error instanceof SandboxStackError
              ? 'stack'
              : undefined;
      if (limitKind !== undefined) {
        return { ok: false, phase: 'limit', kind: limitKind, logs };
      }
      if (error instanceof SandboxRuntimeError) {
        return {
          ok: false,
          phase: 'runtime',
          error: {
            name: error.guestName,
            message: error.message,
            line:
              error.line === undefined ? undefined : Math.max(1, error.line - wrapped.lineOffset),
            guestStack: error.guestStack,
          },
          logs,
        };
      }
      throw error;
    }
  }

  function asTool(): ExecuteTypescriptToolDescriptor {
    return {
      name: 'execute_typescript',
      description: buildToolDescription(decls),
      inputSchema: z.object({ code: z.string() }),
      inputJsonSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              'A TypeScript program body (statements only, no import/export). ' +
              'Produce the final result with a return statement.',
          },
        },
        required: ['code'],
      },
      execute: async ({ code }) => renderResult(await execute(code)),
    };
  }

  function renderResult(result: ExecutionResult): string {
    if (result.ok) {
      const logs = result.logs.length > 0 ? `\nLogs:\n${result.logs.join('\n')}` : '';
      return `Result:\n${JSON.stringify(result.value, null, 2)}${logs}`;
    }
    switch (result.phase) {
      case 'check': {
        const list = result.diagnostics
          .map((d, i) => `${i + 1}. line ${d.line}, col ${d.column}: TS${d.code} ${d.message}`)
          .join('\n');
        const followUp =
          result.repairsRemaining > 0
            ? `Fix these errors and call execute_typescript again with the corrected program. ` +
              `${result.repairsRemaining} repair attempt${result.repairsRemaining === 1 ? '' : 's'} remaining.`
            : 'Do not retry; report the problem to the user instead.';
        return `Type errors:\n${list}\n\n${followUp}`;
      }
      case 'runtime': {
        const at = result.error.line !== undefined ? ` (line ${result.error.line})` : '';
        const logs =
          result.logs.length > 0 ? `\nLogs before failure:\n${result.logs.join('\n')}` : '';
        return `Runtime error${at}: ${result.error.name}: ${result.error.message}${logs}`;
      }
      case 'limit':
        return `Execution aborted: program exceeded its ${result.kind} limit.`;
    }
  }

  return {
    declarations: () => decls,
    execute,
    asTool,
    resetRepairs: () => {
      repairAttempts = 0;
    },
    dispose: async () => {
      await checker.dispose?.();
      await sandbox.dispose?.();
    },
  };
}

function resolveChecker(choice: CheckerKind | Checker): Checker {
  if (typeof choice !== 'string') return choice;
  switch (choice) {
    case 'none':
      return new NoneChecker();
    case 'in-process':
      return new InProcessChecker();
    case 'tsgo':
      return new FallbackChecker(new TsgoChecker(), () => new InProcessChecker(), 'tsgo');
  }
}

function resolveSandbox(choice: SandboxKind | Sandbox): Sandbox {
  if (typeof choice !== 'string') return choice;
  return new QuickJSSandbox();
}

function buildBindings(tools: readonly AnyTool[]): Record<string, SandboxBinding> {
  const bindings: Record<string, SandboxBinding> = {};
  for (const tool of tools) {
    bindings[tool.name] = async (...args: unknown[]) => {
      const parsed = tool.input.safeParse(args[0] ?? {});
      if (!parsed.success) {
        throw new ToolCallError(
          tool.name,
          `Invalid input for tool "${tool.name}": ${formatZodError(parsed.error)}`,
        );
      }
      let result: unknown;
      try {
        result = await tool.impl(parsed.data);
      } catch (cause) {
        throw new ToolCallError(
          tool.name,
          `Tool "${tool.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
      const output = tool.output.safeParse(result);
      if (!output.success) {
        throw new ToolCallError(
          tool.name,
          `Tool "${tool.name}" returned a value that does not match its output schema: ` +
            formatZodError(output.error),
        );
      }
      return output.data;
    };
  }
  return bindings;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

function buildToolDescription(decls: string): string {
  return [
    'Execute a TypeScript program that orchestrates the declared tools.',
    'Write plain statements (no import/export, no top-level function wrapper);',
    '`await` is available, and the final result must be produced with `return`.',
    'Intermediate data stays out of your context — only the returned value and',
    'console logs come back. The program is type-checked before it runs; if type',
    'errors come back, fix them and resubmit.',
    '',
    'Available declarations:',
    '```typescript',
    decls.trimEnd(),
    '```',
  ].join('\n');
}
