import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { TsgoUnavailableError } from '../errors';

/**
 * Locate the tsgo binary: explicit env override, then the
 * @typescript/native-preview package, then a tsgo on PATH.
 */
export function resolveTsgoBinary(): string {
  const fromEnv = process.env['TOOLWEAVE_TSGO'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('@typescript/native-preview/package.json');
    const pkg = require('@typescript/native-preview/package.json') as {
      bin?: Record<string, string>;
    };
    const bin = pkg.bin?.['tsgo'];
    if (bin !== undefined) return path.join(path.dirname(pkgPath), bin);
  } catch {
    // Package not installed; try PATH next.
  }

  const probe = spawnSync('tsgo', ['--version'], { stdio: 'ignore' });
  if (probe.error === undefined && probe.status === 0) return 'tsgo';

  throw new TsgoUnavailableError(
    'Could not find the tsgo binary. Install the optional peer dependency ' +
      '"@typescript/native-preview", put tsgo on your PATH, or set TOOLWEAVE_TSGO.',
  );
}
