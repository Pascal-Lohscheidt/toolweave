import { describe, expect, it } from 'vitest';
import { NoneChecker } from './none';

describe('NoneChecker', () => {
  it('returns no diagnostics for anything', async () => {
    const checker = new NoneChecker();
    expect(await checker.check()).toEqual([]);
  });
});
