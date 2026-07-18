# LangGraph agent demo

A ReAct agent with exactly one tool — toolweave's `execute_typescript` — over an in-memory
outdoor-shop backend with ten tools (catalog search, product details, per-warehouse inventory,
reviews, customers, orders, order creation with stock mutation, discount codes, shipping
quotes, currency conversion). Instead of a model round-trip per tool call, the agent writes
one typed TypeScript program (checked by tsgo, executed in the QuickJS sandbox) and only the
final result returns to the model.

The schemas deliberately cover the whole surface: enums, defaults, optionals, nested objects,
records, a union output (`checkDiscountCode`), throwing tools (unknown ids), and a mutating
tool (`createOrder`). Good prompts to try:

- "Which in-stock products under 100 € have an average rating of at least 4?"
- "Order 2 energy bar boxes for anna@example.com with the best valid discount code, then
  quote express shipping to her address."
- "What would the GPS watch cost in USD including standard shipping to Vienna?"

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
