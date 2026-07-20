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
