import { describe, expect, it, vi } from 'vitest';
import { CheckerUnavailableError } from '../errors';
import type { Checker, Diagnostic } from '../types';
import { FallbackChecker } from './fallback';

function stubChecker(overrides: Partial<Checker>): Checker & { dispose: () => Promise<void> } {
  return {
    check: async () => [],
    dispose: async () => undefined,
    ...overrides,
  };
}

describe('FallbackChecker', () => {
  it('passes checks straight through while the primary is healthy', async () => {
    const primary = stubChecker({ check: async () => [{ line: 3 } as Diagnostic] });
    const checker = new FallbackChecker(primary, () => stubChecker({}), 'tsgo');
    expect(await checker.check('x', 'd')).toEqual([{ line: 3 }]);
  });

  it('swaps to the fallback once, on the first unavailability, and disposes the primary', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const disposePrimary = vi.fn(async () => undefined);
    const primary = stubChecker({
      check: async () => {
        throw new CheckerUnavailableError('binary missing');
      },
      dispose: disposePrimary,
    });
    const fallbackCheck = vi.fn(async () => [{ line: 1 } as Diagnostic]);
    const makeFallback = vi.fn(() => stubChecker({ check: fallbackCheck }));

    const checker = new FallbackChecker(primary, makeFallback, 'tsgo');

    // First call trips the swap and is answered by the fallback.
    expect(await checker.check('a', 'd')).toEqual([{ line: 1 }]);
    // Second call goes straight to the fallback — no second construction.
    expect(await checker.check('b', 'd')).toEqual([{ line: 1 }]);

    expect(makeFallback).toHaveBeenCalledTimes(1);
    expect(disposePrimary).toHaveBeenCalledTimes(1);
    expect(fallbackCheck).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('rethrows errors that are not CheckerUnavailableError without falling back', async () => {
    const makeFallback = vi.fn(() => stubChecker({}));
    const primary = stubChecker({
      check: async () => {
        throw new Error('genuine bug');
      },
    });
    const checker = new FallbackChecker(primary, makeFallback, 'tsgo');
    await expect(checker.check('a', 'd')).rejects.toThrow('genuine bug');
    expect(makeFallback).not.toHaveBeenCalled();
  });

  it('disposes whichever checker is currently active', async () => {
    const dispose = vi.fn(async () => undefined);
    const checker = new FallbackChecker(stubChecker({ dispose }), () => stubChecker({}));
    await checker.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
