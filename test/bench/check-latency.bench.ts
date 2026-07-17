/**
 * Warm-check latency per checker backend. Run with `pnpm bench`.
 *
 * Cold start (first check: lib load / process spawn) is reported separately
 * below via a one-shot measurement, because bench iterations only ever see
 * the warm path.
 */
import { bench, describe } from 'vitest';
import { InProcessChecker } from '../../src/checker/inprocess';
import { TsgoChecker } from '../../src/checker/tsgo';
import { resolveTsgoBinary } from '../../src/checker/resolve-tsgo';
import { CONFORMANCE_DECLS } from '../conformance/checker-conformance';

const CLEAN = [
  "const docs = await searchDocs({ query: 'hello', limit: 3 });",
  "const weather = await getWeather({ city: 'Berlin' });",
  'return { count: docs.length, tempC: weather.tempC };',
].join('\n');
const BROKEN = 'return await searchDocs({ query: 42 });';

async function coldStart(name: string, make: () => { check: Function; dispose?: Function }) {
  const checker = make();
  const start = performance.now();
  await checker.check(CLEAN, CONFORMANCE_DECLS);
  const elapsed = performance.now() - start;
  console.log(`[cold] ${name}: first check ${elapsed.toFixed(1)}ms`);
  return checker;
}

const inProcess = await coldStart('in-process', () => new InProcessChecker());

let tsgo: TsgoChecker | undefined;
try {
  resolveTsgoBinary();
  tsgo = (await coldStart('tsgo', () => new TsgoChecker())) as TsgoChecker;
} catch {
  console.warn('tsgo not available; benching in-process only');
}

describe('warm check latency', () => {
  bench('in-process / clean program', async () => {
    await inProcess.check(CLEAN, CONFORMANCE_DECLS);
  });
  bench('in-process / program with type error', async () => {
    await inProcess.check(BROKEN, CONFORMANCE_DECLS);
  });
  if (tsgo !== undefined) {
    const checker = tsgo;
    bench('tsgo / clean program', async () => {
      await checker.check(CLEAN, CONFORMANCE_DECLS);
    });
    bench('tsgo / program with type error', async () => {
      await checker.check(BROKEN, CONFORMANCE_DECLS);
    });
  }
});
