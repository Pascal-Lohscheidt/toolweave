import { z } from 'zod';
import type { ExecutionResult } from '../types';
import type { ToolweaveRuntime } from '../runtime';

/**
 * The framework-neutral `execute_typescript` tool: the port every framework
 * adapter plugs into. It carries the schema in both flavors (Zod and plain
 * JSON Schema) and renders every ExecutionResult as model-facing text, so
 * diagnostic formatting and repair-budget messaging stay identical across
 * frameworks.
 */
export interface ExecuteTypescriptToolDescriptor {
  name: 'execute_typescript';
  description: string;
  inputSchema: z.ZodType<{ code: string }>;
  inputJsonSchema: Record<string, unknown>;
  execute(input: { code: string }): Promise<string>;
}

/**
 * Package a runtime's whole check → repair → execute loop as one tool.
 * Built entirely on the public runtime interface — custom adapters can do
 * the same, or wrap this descriptor.
 */
export function asTool(runtime: ToolweaveRuntime): ExecuteTypescriptToolDescriptor {
  return {
    name: 'execute_typescript',
    description: buildToolDescription(runtime.declarations()),
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
    execute: async ({ code }) => renderResult(await runtime.execute(code)),
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
