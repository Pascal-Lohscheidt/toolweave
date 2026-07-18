import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../src/tools/define';
import { generateDeclarations } from '../../src/tools/codegen';
import type { Checker, Diagnostic } from '../../src/types';

const searchDocs = defineTool({
  name: 'searchDocs',
  description: 'Full-text search over the knowledge base',
  input: z.object({ query: z.string(), limit: z.number().default(5) }),
  output: z.array(z.object({ id: z.string(), text: z.string() })),
  impl: async () => [],
});

const getWeather = defineTool({
  name: 'getWeather',
  description: 'Get current weather for a city',
  input: z.object({ city: z.string(), unit: z.enum(['c', 'f']).default('c') }),
  output: z.object({ tempC: z.number(), description: z.string() }),
  impl: async () => ({ tempC: 20, description: 'sunny' }),
});

export const CONFORMANCE_DECLS = generateDeclarations([searchDocs, getWeather]);

const errorsOn = (diagnostics: Diagnostic[]) => diagnostics.filter((d) => d.severity === 'error');

/**
 * The behavioral contract every real checker backend must satisfy. Running
 * the same suite against each backend is what makes them drop-in swappable.
 */
export function runCheckerConformance(name: string, makeChecker: () => Checker): void {
  describe(`checker conformance: ${name}`, () => {
    let checker: Checker;
    beforeAll(() => {
      checker = makeChecker();
    });
    afterAll(async () => {
      await checker.dispose?.();
    });

    const check = (source: string) => checker.check(source, CONFORMANCE_DECLS);

    it('accepts a clean program using tools, console, and await', async () => {
      const diagnostics = await check(
        [
          "const docs = await searchDocs({ query: 'hello' });",
          'console.log(docs.length);',
          "const weather = await getWeather({ city: 'Berlin', unit: 'f' });",
          'return { docs, weather };',
        ].join('\n'),
      );
      expect(errorsOn(diagnostics)).toEqual([]);
    });

    it('reports a syntax error on the right line', async () => {
      const diagnostics = await check('const x = ;\nreturn x;');
      const errors = errorsOn(diagnostics);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.line).toBe(1);
    });

    it('reports a mistyped tool argument on the right line', async () => {
      const diagnostics = await check(
        ['const limit = 3;', 'return await searchDocs({ query: limit });'].join('\n'),
      );
      const errors = errorsOn(diagnostics);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.line).toBe(2);
      expect(errors[0]!.message).toMatch(/number|string/);
    });

    it('reports missing-await misuse of a tool result', async () => {
      const diagnostics = await check(
        ["const docs = searchDocs({ query: 'x' });", 'return docs.length;'].join('\n'),
      );
      const errors = errorsOn(diagnostics);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.line).toBe(2);
    });

    it('rejects unknown tool names', async () => {
      const diagnostics = await check("return await fetchTweets({ q: 'x' });");
      const errors = errorsOn(diagnostics);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.line).toBe(1);
    });

    it('has no DOM lib: document is not defined', async () => {
      const diagnostics = await check('return document.title;');
      expect(errorsOn(diagnostics).length).toBeGreaterThan(0);
    });

    it('has no Node types: process is not defined', async () => {
      const diagnostics = await check('return process.env;');
      expect(errorsOn(diagnostics).length).toBeGreaterThan(0);
    });

    it('rejects non-erasable syntax (enum) so the strip-transpiler stays safe', async () => {
      const diagnostics = await check('enum Mode { A }\nreturn Mode.A;');
      expect(errorsOn(diagnostics).length).toBeGreaterThan(0);
    });

    it('rejects import declarations (no module loader in the sandbox)', async () => {
      const diagnostics = await check("import fs from 'node:fs';\nreturn fs;");
      expect(errorsOn(diagnostics).length).toBeGreaterThan(0);
    });

    it('turns a missing top-level return into an actionable diagnostic', async () => {
      // The classic failure mode: the model wraps its logic in its own
      // function and calls it as the last statement instead of returning.
      const diagnostics = await check(
        [
          'async function main() {',
          "  return await searchDocs({ query: 'x' });",
          '}',
          'main();',
        ].join('\n'),
      );
      const errors = errorsOn(diagnostics);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]!.code).toBe(2355);
      expect(errors[0]!.line).toBe(1);
      expect(errors[0]!.message).toMatch(/top-level `return/);
    });

    it('is warm: repeated checks return consistent results', async () => {
      const clean = "return await getWeather({ city: 'Rome' });";
      for (let i = 0; i < 3; i++) {
        expect(errorsOn(await check(clean))).toEqual([]);
        expect(errorsOn(await check('return nope();')).length).toBeGreaterThan(0);
      }
    });
  });
}
