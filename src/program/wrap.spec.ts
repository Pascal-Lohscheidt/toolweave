import { describe, expect, it } from 'vitest';
import { EXECUTE_SUFFIX, wrapProgram } from './wrap';

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

  it('exposes an execute suffix that calls __main__', () => {
    expect(EXECUTE_SUFFIX).toBe('__main__();');
  });
});
