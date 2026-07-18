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

/**
 * Friendly replacement message for a diagnostic that lands on the wrapper
 * itself (mapped line < 1) rather than in the model's code. Returns undefined
 * for codes that should pass through unchanged.
 *
 * TS2355 ("A function whose declared type ... must return a value") fires on
 * `__main__`'s return type when the program body has no top-level `return` —
 * typically because the model wrapped its logic in its own function and called
 * it as the last statement. Reported verbatim it points at line 1 of the
 * model's code with a message about a function the model never wrote, which
 * repair loops cannot decode.
 */
export function wrapperDiagnosticMessage(code: number): string | undefined {
  if (code === 2355) {
    return (
      'The program must produce its result with a top-level `return <value>;` statement. ' +
      'Do not wrap the code in a function that you call as the last statement — ' +
      'write plain statements and end with `return`.'
    );
  }
  return undefined;
}
