import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 100,
    tabWidth: 2,
  },
  lint: {
    plugins: ['typescript'],
  },
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    passWithNoTests: true,
    // In-process checker cold-start (lib.*.d.ts parse) routinely exceeds the
    // 5s default under CI load when several workers warm TypeScript at once.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    typecheck: {
      enabled: true,
      include: ['src/**/*.spec-d.ts'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.spec-d.ts'],
      // Coverage is a gate, not a report: `vitest run --coverage` exits non-zero
      // (failing CI) when any threshold below is missed.
      //
      // Every first-party logic module is locked at 100% line coverage via the
      // per-file globs below. The few genuinely unreachable spots inside them —
      // malformed-schema guards, a non-Error `String(cause)` fallback, a
      // one-shot cleanup handler — carry inline `v8 ignore` comments that
      // double as documentation.
      //
      // Four boundary "driver" modules are held to a documented floor instead
      // of 100%: they wrap an external tsgo subprocess, the optional `typescript`
      // peer, and the QuickJS WASM sandbox. Their happy paths are exercised by
      // the conformance + e2e suites; the residue is subprocess-death,
      // missing-peer, PATH-probe, and sandbox-cancellation recovery that no
      // unit test can sensibly reach. The floors ratchet — they can't regress.
      //
      // Note: vitest does NOT remove glob-matched files from the aggregate, so
      // the global numbers below are conservative backstops over ALL files
      // (drivers included), while the per-file globs do the real locking.
      thresholds: {
        autoUpdate: false,
        // Aggregate backstop (drivers drag these under 100 by design).
        lines: 93,
        statements: 91,
        functions: 92,
        branches: 80,

        // First-party logic — locked at 100% lines (glob keys match abs paths).
        '**/runtime.ts': { lines: 100 },
        '**/transpile.ts': { lines: 100 },
        '**/program/wrap.ts': { lines: 100 },
        '**/tools/define.ts': { lines: 100 },
        '**/tools/codegen.ts': { lines: 100 },
        '**/adapters/descriptor.ts': { lines: 100 },
        '**/adapters/langgraph.ts': { lines: 100 },
        '**/checker/none.ts': { lines: 100 },
        '**/checker/fallback.ts': { lines: 100 },
        '**/checker/lsp/jsonrpc.ts': { lines: 100 },
        '**/sandbox/marshal.ts': { lines: 100 },

        // Boundary drivers — floored at (roughly) current coverage.
        '**/checker/tsgo.ts': { lines: 79, statements: 78, functions: 76, branches: 70 },
        '**/checker/resolve-tsgo.ts': { lines: 72, statements: 64, functions: 100, branches: 30 },
        '**/checker/inprocess.ts': { lines: 90, statements: 90, functions: 83, branches: 77 },
        '**/sandbox/quickjs.ts': { lines: 96, statements: 95, functions: 100, branches: 78 },
      },
    },
  },
  pack: {
    entry: {
      index: 'src/index.ts',
      'adapters/langgraph': 'src/adapters/langgraph.ts',
    },
    format: ['esm', 'cjs'],
    platform: 'node',
    dts: true,
    sourcemap: true,
    deps: {
      neverBundle: [
        'typescript',
        '@typescript/native-preview',
        'zod',
        '@langchain/core',
        'quickjs-emscripten-core',
        '@jitl/quickjs-singlefile-mjs-release-sync',
        'amaro',
      ],
    },
  },
});
