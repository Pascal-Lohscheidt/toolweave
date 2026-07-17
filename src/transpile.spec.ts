import { describe, expect, it } from 'vitest';
import { wrapProgram } from './program/wrap';
import { stripTypes } from './transpile';

describe('stripTypes', () => {
  it('strips annotations while preserving line count and token columns', () => {
    const source = [
      'const a: number = 1;',
      'const b = { x: 1 } as { x: number };',
      'return a + b.x;',
    ].join('\n');
    const stripped = stripTypes(wrapProgram(source).text);
    const lines = stripped.split('\n');
    expect(lines.length).toBe(wrapProgram(source).text.split('\n').length);
    // Position preservation: `const b` starts at the same column on the same line.
    expect(lines[2]!.indexOf('const b')).toBe(0);
    expect(lines[3]!.indexOf('return a')).toBe(0);
    expect(stripped).not.toContain(': number');
    expect(stripped).not.toContain(' as ');
  });

  it('keeps async/await intact', () => {
    const stripped = stripTypes(wrapProgram('const x = await f();\nreturn x;').text);
    expect(stripped).toContain('async function __main__()');
    expect(stripped).toContain('await f()');
  });
});
