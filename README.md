# toolweave

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/Pascal-Lohscheidt/toolweave/tree/main.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/Pascal-Lohscheidt/toolweave/tree/main)
[![npm version](https://img.shields.io/npm/v/toolweave)](https://www.npmjs.com/package/toolweave)
[![npm downloads](https://img.shields.io/npm/dm/toolweave)](https://www.npmjs.com/package/toolweave)
[![license](https://img.shields.io/npm/l/toolweave)](./LICENSE)

Typed code-mode tool orchestration for LLM agents.

Instead of emitting one tool call per model round-trip, the agent writes a **single typed
TypeScript program** that composes your tools — with loops, conditionals, and data reshaping.
toolweave type-checks the program against declarations generated from your Zod schemas, feeds
type errors back as structured diagnostics (so the agent self-repairs), strips the types, and
executes the program in a QuickJS sandbox. Only the final result returns to the model — the
intermediate data never touches your context window.

> Work in progress — scaffolded, core loop landing milestone by milestone.

## The loop

```
tool definitions (Zod)
      │  generate .d.ts + runtime bindings
      ▼
model writes TS program ──► Checker (type-check) ──► errors? ──► diagnostics back to agent
      │                                                │ no
      └──────────────► transpile (strip types) ──► QuickJS sandbox ──► result
```

## License

MIT © Pascal Lohscheidt
