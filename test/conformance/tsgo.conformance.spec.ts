import { describe, expect, it } from 'vitest';
import { TsgoChecker } from '../../src/checker/tsgo';
import { InProcessChecker } from '../../src/checker/inprocess';
import { resolveTsgoBinary } from '../../src/checker/resolve-tsgo';
import { CONFORMANCE_DECLS, runCheckerConformance } from './checker-conformance';

let tsgoAvailable = true;
try {
  resolveTsgoBinary();
} catch {
  tsgoAvailable = false;
  // eslint-disable-next-line no-console
  console.warn('tsgo binary not found — skipping tsgo conformance suite');
}

if (tsgoAvailable) {
  runCheckerConformance('tsgo', () => new TsgoChecker());

  describe('tsgo / in-process parity', () => {
    it('reports errors on the same lines as the in-process checker', async () => {
      const fixtures = [
        'const x = ;\nreturn x;',
        'const limit = 3;\nreturn await searchDocs({ query: limit });',
        "const docs = searchDocs({ query: 'x' });\nreturn docs.length;",
        'return document.title;',
        'enum Mode { A }\nreturn Mode.A;',
      ];
      const tsgo = new TsgoChecker();
      const inProcess = new InProcessChecker();
      try {
        for (const source of fixtures) {
          const a = await tsgo.check(source, CONFORMANCE_DECLS);
          const b = await inProcess.check(source, CONFORMANCE_DECLS);
          const linesA = [...new Set(a.filter((d) => d.severity === 'error').map((d) => d.line))];
          const linesB = [...new Set(b.filter((d) => d.severity === 'error').map((d) => d.line))];
          expect(linesA, `fixture: ${source}`).toEqual(linesB);
        }
      } finally {
        await tsgo.dispose();
        await inProcess.dispose();
      }
    }, 30_000);
  });
} else {
  describe.skip('checker conformance: tsgo (binary unavailable)', () => {
    it('runs the shared checker conformance suite against the tsgo backend', () => {
      // Placeholder so the skip is reported with a meaningful name; the real
      // suite is registered by runCheckerConformance() when tsgo is present.
    });
  });
}
