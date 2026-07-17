/**
 * Compiler options every checker backend applies to generated programs,
 * expressed as tsconfig-JSON values so they can feed both the in-process
 * LanguageService (via convertCompilerOptionsFromJson) and tsgo's on-disk
 * tsconfig.json.
 *
 * - no DOM and no @types: the sandbox has neither browser nor Node APIs.
 * - erasableSyntaxOnly: the transpiler is strip-only, so enums/namespaces
 *   must surface as repairable type errors, not transpile crashes.
 */
export const CHECK_COMPILER_OPTIONS = {
  strict: true,
  target: 'es2022',
  module: 'esnext',
  moduleResolution: 'bundler',
  lib: ['es2023'],
  types: [],
  noEmit: true,
  erasableSyntaxOnly: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
} as const;

/** Virtual file names shared by checker backends. */
export const MAIN_FILE = 'main.ts';
export const DECLS_FILE = 'decls.d.ts';
