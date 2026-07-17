import type { Checker, Diagnostic } from '../types';

/**
 * The transpile-only backend: skip type-checking entirely and trust the
 * model. Programs still fail at runtime on real errors; there is just no
 * repair loop before execution.
 */
export class NoneChecker implements Checker {
  check(): Promise<Diagnostic[]> {
    return Promise.resolve([]);
  }
}
