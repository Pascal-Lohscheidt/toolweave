# LangGraph agent demo

A ReAct agent with exactly one tool — toolweave's `execute_typescript` — over a tiny
in-memory product catalog. Instead of a model round-trip per tool call, the agent writes one
typed TypeScript program (checked by tsgo, executed in the QuickJS sandbox) and only the final
result returns to the model.

## Run it

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY or OPENAI_API_KEY
pnpm install           # from the repo root
pnpm app               # chat UI → http://localhost:8787
pnpm start             # or: one-shot CLI version
```

The chat UI shows the assistant's answer plus collapsible panels with the exact program the
model wrote and what came back from the sandbox.

Model selection: `ANTHROPIC_API_KEY` → `claude-sonnet-5`, else `OPENAI_API_KEY` →
`gpt-4o-mini`; override with `DEMO_MODEL`.

This example is a private workspace package — it is not built, published, or part of CI.
