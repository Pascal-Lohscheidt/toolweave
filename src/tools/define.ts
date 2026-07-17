import type { z } from 'zod';
import { ToolDefinitionError } from '../errors';

export interface ToolConfig<TIn extends z.ZodType, TOut extends z.ZodType> {
  /**
   * The tool's name as the model will call it. Becomes a global function in
   * the generated program, so it must be a valid JavaScript identifier.
   */
  name: string;
  /** Shown to the model as JSDoc above the generated declaration. */
  description: string;
  /** Zod schema for the single input object the tool receives. */
  input: TIn;
  /** Zod schema for the tool's resolved value. */
  output: TOut;
  /** The host-side implementation. Receives parsed input (defaults applied). */
  impl: (input: z.output<TIn>) => Promise<z.input<TOut>> | z.input<TOut>;
}

export interface Tool<
  TIn extends z.ZodType = z.ZodType,
  TOut extends z.ZodType = z.ZodType,
> extends ToolConfig<TIn, TOut> {
  readonly kind: 'toolweave.tool';
}

/** A tool with its schema type parameters erased, as stored by the runtime. */
export type AnyTool = Tool<z.ZodType, z.ZodType>;

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Words that are illegal as function names in strict-mode ES2022, plus the
// globals toolweave itself injects into the program environment.
const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'arguments',
  'eval',
  'console',
  '__main__',
]);

/**
 * Define a tool the model can call from its generated program.
 *
 * The schemas serve three purposes: they are compiled into the TypeScript
 * declarations handed to the model, they validate every call crossing the
 * sandbox boundary at runtime, and they type `impl` for the tool author.
 */
export function defineTool<TIn extends z.ZodType, TOut extends z.ZodType>(
  config: ToolConfig<TIn, TOut>,
): Tool<TIn, TOut> {
  if (!IDENTIFIER_RE.test(config.name)) {
    throw new ToolDefinitionError(
      `Tool name "${config.name}" is not a valid JavaScript identifier. ` +
        'It becomes a global function in the generated program.',
    );
  }
  if (RESERVED.has(config.name)) {
    throw new ToolDefinitionError(`Tool name "${config.name}" is a reserved word.`);
  }
  if (!config.description.trim()) {
    throw new ToolDefinitionError(
      `Tool "${config.name}" needs a non-empty description — it is the model's only ` +
        'documentation for what the tool does.',
    );
  }
  return { ...config, kind: 'toolweave.tool' };
}
