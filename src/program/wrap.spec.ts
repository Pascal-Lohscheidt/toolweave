import { describe, expect, it } from 'vitest';
import { EXECUTE_SUFFIX, wrapProgram, wrapperDiagnosticMessage } from './wrap';

describe('wrapProgram', () => {
  it('wraps the body in an async __main__ with a constant line offset', () => {
    const { text, lineOffset } = wrapProgram('return 1;');
    expect(text).toBe('async function __main__(): Promise<unknown> {\nreturn 1;\n}\n');
    expect(lineOffset).toBe(1);
  });

  it('keeps every source line at its column (no re-indentation)', () => {
    const source = 'const a = 1;\n  const b = 2;\nreturn a + b;';
    const { text, lineOffset } = wrapProgram(source);
    const lines = text.split('\n');
    expect(lines[0 + lineOffset]).toBe('const a = 1;');
    expect(lines[1 + lineOffset]).toBe('  const b = 2;');
    expect(lines[2 + lineOffset]).toBe('return a + b;');
  });
});

describe('EXECUTE_SUFFIX', () => {
  it('calls __main__ so evaluating the wrapped text yields its promise', () => {
    expect(EXECUTE_SUFFIX).toBe('__main__();');
  });
});

describe('wrapperDiagnosticMessage', () => {
  it('replaces TS2355 (missing top-level return) with a model-actionable message', () => {
    const message = wrapperDiagnosticMessage(2355);
    expect(message).toContain('top-level `return');
    expect(message).toContain('Do not wrap the code in a function');
  });

  it('passes other diagnostic codes through unchanged (undefined)', () => {
    expect(wrapperDiagnosticMessage(2322)).toBeUndefined();
  });
});
