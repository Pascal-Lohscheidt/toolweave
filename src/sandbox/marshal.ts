import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';

/**
 * Host → guest via JSON round-trip. Tool IO is Zod-validated JSON-safe data
 * by construction, so structural fidelity is guaranteed and this stays far
 * simpler than walking values handle by handle.
 */
export function marshalToHandle(context: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) return context.undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return context.undefined;
  // U+2028/29 are valid JSON but illegal in pre-ES2019 source; escape defensively.
  const source = `(${json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')})`;
  return context.unwrapResult(context.evalCode(source));
}

/** Host error → guest Error handle with name and message preserved. */
export function errorToHandle(context: QuickJSContext, error: unknown): QuickJSHandle {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const handle = context.newError(message);
  context.newString(name).consume((n) => context.setProp(handle, 'name', n));
  return handle;
}

/** Render one console.log(...) call's dumped arguments as a log line. */
export function formatLogLine(args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : (JSON.stringify(a) ?? String(a)))).join(' ');
}
