export interface WrappedProgram {
  /** The program text every checker checks and the sandbox executes. */
  text: string;
  /** Lines prepended before the model's code. Subtract from diagnostic lines. */
  lineOffset: number;
}

/**
 * Wrap the model's program body in an async function.
 *
 * The model writes plain statements and produces its result with `return`.
 * Wrapping (instead of evaluating a module) makes `await` legal, makes
 * `import`/`export` a syntax error (the sandbox has no module loader), and
 * keeps the line mapping a constant offset: the model's line N is wrapped
 * line N + lineOffset. The body is not re-indented so columns pass through.
 */
export function wrapProgram(source: string): WrappedProgram {
  return {
    text: `async function __main__(): Promise<unknown> {\n${source}\n}\n`,
    lineOffset: 1,
  };
}

/** Appended after the (transpiled) wrapped text so evaluating it yields the program's promise. */
export const EXECUTE_SUFFIX = '__main__();';
