import { describe, expect, it } from 'vitest';
import { TsgoUnavailableError } from '../errors';
import { FallbackChecker } from './fallback';
import { TsgoChecker } from './tsgo';

const DECLS = 'declare function ping(input: { n: number }): Promise<number>;';

describe('TsgoChecker', () => {
  it('fails with TsgoUnavailableError for a bogus binary, twice, then permanently', async () => {
    const checker = new TsgoChecker({ binaryPath: '/nonexistent/tsgo-binary' });
    await expect(checker.check('return 1;', DECLS)).rejects.toThrow(TsgoUnavailableError);
    await expect(checker.check('return 1;', DECLS)).rejects.toThrow(TsgoUnavailableError);
    await expect(checker.check('return 1;', DECLS)).rejects.toThrow(/twice/);
    await checker.dispose();
  });

  it('falls back to the in-process checker through FallbackChecker', async () => {
    const checker = new FallbackChecker(
      new TsgoChecker({ binaryPath: '/nonexistent/tsgo-binary' }),
      () => ({
        check: async () => [
          { message: 'from-fallback', line: 1, column: 1, code: 0, severity: 'error' as const },
        ],
      }),
      'tsgo',
    );
    const diagnostics = await checker.check('return 1;', DECLS);
    expect(diagnostics[0]!.message).toBe('from-fallback');
    // Subsequent checks stay on the fallback without re-probing tsgo.
    const again = await checker.check('return 2;', DECLS);
    expect(again[0]!.message).toBe('from-fallback');
    await checker.dispose();
  });
});
