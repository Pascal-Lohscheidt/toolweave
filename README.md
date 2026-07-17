# toolweave

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/Pascal-Lohscheidt/toolweave/tree/main.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/Pascal-Lohscheidt/toolweave/tree/main)
[![npm version](https://img.shields.io/npm/v/toolweave)](https://www.npmjs.com/package/toolweave)
[![npm downloads](https://img.shields.io/npm/dm/toolweave)](https://www.npmjs.com/package/toolweave)
[![license](https://img.shields.io/npm/l/toolweave)](./LICENSE)

**Typed code-mode tool orchestration for LLM agents.**

Instead of one tool call per model round-trip, the agent writes a single **typed TypeScript
program** that composes your tools — loops, conditionals, data reshaping. toolweave type-checks
the program against declarations generated from your Zod schemas, feeds type errors back as
structured diagnostics (so the agent self-repairs _before_ anything runs), strips the types, and
executes the result in a QuickJS sandbox. Only the final `return` value reaches the model;
intermediate data never touches your context window.

```
tool definitions (Zod)
      │  generate .d.ts + runtime bindings
      ▼
model writes TS program ──► Checker (type-check) ──► errors? ──► diagnostics back to the agent loop
      │                                                │ no
      └──────────────► transpile (strip types) ──► QuickJS sandbox ──► final result only
```

The differentiator over other "code mode" implementations is the **routeable type layer**:
checker backends are swappable behind one interface, so you can start with zero infra and route
to the native tsgo compiler without touching agent code. toolweave itself **never calls an LLM**
— your agent framework's own tool loop drives the repair cycle.

## Quick start

```bash
npm install toolweave zod
# recommended: the native TS 7 checker (default, ~0.4ms warm checks)
npm install @typescript/native-preview
# or the classic in-process fallback
npm install typescript
```

```ts
import { z } from 'zod';
import { createRuntime, defineTool } from 'toolweave';

const searchDocs = defineTool({
  name: 'searchDocs',
  description: 'Full-text search over the knowledge base',
  input: z.object({ query: z.string(), limit: z.number().default(5) }),
  output: z.array(z.object({ id: z.string(), text: z.string() })),
  impl: async ({ query, limit }) => db.search(query, limit),
});

const runtime = createRuntime({
  tools: [searchDocs],
  checker: 'tsgo', // routeable: 'tsgo' | 'in-process' | 'none' | custom Checker
  sandbox: 'quickjs',
  maxRepairs: 2,
  limits: { timeoutMs: 10_000, memoryMb: 64 },
});

// 1. Put the generated declarations into your agent's prompt:
runtime.declarations();

// 2. Expose the loop as a single tool to any agent framework:
const codeTool = runtime.asTool(); // { name: 'execute_typescript', description, inputSchema, execute }

// …or drive it yourself:
const result = await runtime.execute(modelWrittenCode);
// { ok: true, value, logs }
// { ok: false, phase: 'check', diagnostics, repairsRemaining }
// { ok: false, phase: 'runtime', error: { name, message, line } , logs }
// { ok: false, phase: 'limit', kind: 'timeout' | 'memory' | 'stack', logs }
```

The model sees real TypeScript declarations (JSDoc from your `.describe()` calls, optionals from
`.default()`):

```ts
/** Full-text search over the knowledge base */
declare function searchDocs(input: {
  query: string;
  /** @default 5 */
  limit?: number;
}): Promise<{ id: string; text: string }[]>;
```

and writes a plain statement body — `await` is available, `import`/`export` are rejected, and the
result is produced with `return`.

### LangGraph

```ts
import { asLangGraphTool } from 'toolweave/adapters/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

const agent = createReactAgent({ llm, tools: [asLangGraphTool(runtime)] });
```

Any framework with a native tool loop works the same way: diagnostics come back as the tool
result, so the model repairs its program through the loop it already has. See
[`examples/`](./examples) for a framework-free walkthrough and a full LangGraph agent.

## The routeable checker

The type-check is the only expensive step, and its cost is dominated by backend warm-up — so it
lives behind an interface with interchangeable backends. Measured on an M-series laptop
(`pnpm bench`):

| Backend          | Cold (first check) | Warm check | Needs                             |
| ---------------- | ------------------ | ---------- | --------------------------------- |
| `tsgo` (default) | ~60ms              | **~0.4ms** | `@typescript/native-preview`      |
| `in-process`     | ~280ms             | ~1.2ms     | `typescript` (>=5.8 <7)           |
| `none`           | —                  | —          | nothing (skips checking entirely) |

- `tsgo` speaks LSP to one long-lived `tsgo --lsp` subprocess (TS 7 dropped the classic
  programmatic API). If the binary is missing it **falls back to `in-process` automatically**
  with a one-time warning.
- All backends run the same conformance test suite — same fixtures, same expected diagnostics,
  same line mapping — which is what makes them drop-in swappable.
- Checked programs get `strict` mode, ES2023 lib, **no DOM, no Node types**, and
  `erasableSyntaxOnly` (so anything the strip-only transpiler can't handle surfaces as a
  repairable type error, never a transpile crash).
- Custom backends: pass any `{ check(source, decls): Promise<Diagnostic[]> }`.

## The sandbox

The default sandbox is QuickJS compiled to wasm (sync single-file build — no native binaries, no
`.wasm` file resolution issues in bundlers):

- Fresh runtime + context per run; model programs are untrusted.
- Hard limits: wall-clock deadline (interrupt handler + host-side race), memory cap, guest stack
  cap.
- Tool calls cross the boundary as host-settled promises; inputs and outputs are validated
  against your Zod schemas on the host side — a program that lies to the type checker still
  can't call a tool with bad data.
- Type stripping via [amaro](https://github.com/nodejs/amaro) preserves positions exactly, so
  guest stack traces map back to the model's source without source maps.
- The `Sandbox` interface is pluggable for isolated-vm / E2B style backends.

## Development

```bash
pnpm install
pnpm test            # vitest (unit + conformance + e2e + leak checks, with typecheck)
pnpm bench           # checker latency, cold vs warm
pnpm lint && pnpm fmt
pnpm build           # vp pack → dist/ (esm + cjs + dts)
```

Requires Node >= 20. The repo uses [Vite+](https://viteplus.dev/) (`vp`) for build/test/lint/fmt.

### Releases

Merges to `main` publish automatically via CircleCI:

1. `scripts/check-publish-needed.ts` halts the publish job if nothing under `src/`,
   `package.json`, or `vite.config.ts` changed since the last release tag.
2. `scripts/bump-and-tag.ts` computes the semver bump from
   [conventional commits](https://www.conventionalcommits.org/) (`feat` → minor, `fix`/`perf` →
   patch, breaking → major; pre-1.0 breaking → minor), writes `package.json` (uncommitted — git
   tags `toolweave@<version>` are the source of truth), tags, and pushes the tag.
3. The package is built and published with `npm publish --no-git-checks`.

One-time CircleCI project setup:

- Add the project and attach a context named **`NPM`** containing `NPM_TOKEN`.
- Add a GitHub **deploy key with write access** (Project Settings → SSH Keys) so the pipeline can
  push release tags.

`pnpm changelog` regenerates `CHANGELOG.md` from conventional commits.

## License

MIT © Pascal Lohscheidt
