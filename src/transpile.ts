import { transformSync } from 'amaro';
import { TranspileError } from './errors';

/**
 * Strip TypeScript types from a checked program.
 *
 * amaro (Node's SWC-based strip-only transform) replaces type syntax with
 * whitespace, so every token keeps its original line and column. Guest stack
 * traces therefore map straight back to the checked source with no source
 * maps. The checker's `erasableSyntaxOnly` guarantees nothing reaches this
 * function that strip mode cannot handle.
 */
export function stripTypes(source: string): string {
  try {
    return transformSync(source, { mode: 'strip-only' }).code;
  } catch (cause) {
    throw new TranspileError(
      // v8 ignore next -- amaro's transformSync always throws Error, so String(cause) is defensive
      `Type stripping failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
