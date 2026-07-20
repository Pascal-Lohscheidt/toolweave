import { CheckerUnavailableError } from '../errors';
import type { Checker, Diagnostic } from '../types';

/**
 * Wraps a preferred checker and swaps to a fallback the first time the
 * preferred backend reports itself unavailable (binary missing, spawn
 * failure). The swap is one-way and logged once — the agent loop never
 * notices which backend answered.
 */
export class FallbackChecker implements Checker {
  private active: Checker;
  private readonly makeFallback: () => Checker;
  private readonly label: string;
  private fellBack = false;

  constructor(primary: Checker, makeFallback: () => Checker, label = 'checker') {
    this.active = primary;
    this.makeFallback = makeFallback;
    this.label = label;
  }

  async check(source: string, decls: string): Promise<Diagnostic[]> {
    try {
      return await this.active.check(source, decls);
    } catch (error) {
      if (this.fellBack || !(error instanceof CheckerUnavailableError)) throw error;
      console.warn(
        `[toolweave] ${this.label} unavailable (${error.message}) — falling back to the in-process checker.`,
      );
      this.fellBack = true;
      const failed = this.active;
      this.active = this.makeFallback();
      /* v8 ignore next -- one-shot best-effort cleanup; the rejection handler rarely fires */
      await failed.dispose?.().catch(() => undefined);
      return this.active.check(source, decls);
    }
  }

  async dispose(): Promise<void> {
    await this.active.dispose?.();
  }
}
