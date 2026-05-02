# RuFlo Research

> Goal-Oriented Action Planning UI for autonomous AI research workflows. Part of the [RuFlo](https://github.com/ruvnet/ruflo) platform.
> Live: [goal.ruv.io](https://goal.ruv.io/) · Agents dashboard: [goal.ruv.io/agents](https://goal.ruv.io/agents)

Turn plain-English research goals into executable agent plans. RuFlo Research applies classic Goal-Oriented Action Planning (GOAP) — A* search through a state space of actions with preconditions and effects — to autonomous AI research, then dispatches the work to live agents you can inspect in real time.

## Highlights

| | |
|---|---|
| 🎯 **Plain-English goals** | Describe an outcome — RuFlo extracts success criteria, constraints, and implicit preconditions |
| 🧭 **GOAP A\* planner** | Shortest-path search through actions with preconditions/effects; replans on the fly when state changes |
| 🤖 **Live agent dashboard** | `/agents` shows every spawned agent — role, current step, status, trajectories |
| 🌳 **Visual plan tree** | Goals render as collapsible action trees with progress, blocked branches, rollbacks |
| ♻️ **Adaptive replanning** | When an action fails, A* re-runs from the current state instead of restarting |
| 🔌 **Embeddable widget** | Drop the research UI into any site via `<script src="widget.js">` |

## Quick Start

```bash
# from /v3/goal_ui
npm install
npm run dev          # main app on http://localhost:8080
```

For the embeddable widget:

```bash
npm run build:widget         # produces dist/widget.js + dist/widget.css
npm run widget:dev           # build widget + start dev server
```

## Project Structure

```
v3/goal_ui/
├── src/
│   ├── components/             # React components (GoalInput, AgentStep, ResearchReportModal, …)
│   ├── pages/                  # Index, Agents, Demo, NotFound
│   ├── lib/goapPlanner.ts      # GOAP A* implementation
│   ├── lib/featureFlags.ts     # VITE_* feature flag accessors (typed)
│   ├── integrations/rvf/       # Browser RVF backend (IndexedDB + ruvector ONNX-WASM)
│   ├── integrations/functions/ # Local/GCF function client (replaces Supabase fns)
│   └── widget.tsx              # Embeddable widget entry
├── functions/                  # Local Node + Google Cloud Functions handlers
│   ├── _lib/sanitize.ts        # wrapUserInput() — prompt-injection defense
│   ├── server.ts               # Hono dev server on :8787 (CORS + token + rate limit)
│   └── <fn-name>/{handler,index}.ts  # 4 wired functions
├── tests/e2e/                  # Playwright suite (22 tests, console-error guard)
├── scripts/                    # check-secrets, check-rvf-format, check-fn-security, …
├── docs/
│   ├── checkpoints/            # Honesty-checkpoint screenshots (step-06/10/15/20/25)
│   ├── ui-inventory.md         # 76 interactive elements catalogued
│   ├── workflow-inventory.md   # 5 workflows × paths
│   ├── migration-matrix.md     # RVF/LOCAL_FN/GCF/DEFER classification
│   ├── audit-known-issues.md   # Accepted-vulnerability register
│   ├── DEPLOYMENT.md, WIDGET-INTEGRATION.md, WIDGET_SETUP.md
├── public/                     # Static assets, widget-embed.html, widget-test.html
├── playwright.config.ts        # E2E config
├── netlify.toml                # Hosting config
└── .optimization-plan.md       # Step-by-step plan (ADR-093 execution log)
```

## Embedding the Widget

```html
<div id="ruflo-research-widget-container"></div>
<script>
  window.RufloResearchWidgetConfig = {
    primaryColor: "#8b5cf6",
    accentColor: "#10b981",
  };
</script>
<script src="https://goal.ruv.io/widget.js"></script>
<link rel="stylesheet" href="https://goal.ruv.io/widget.css" />
```

The widget exposes a global `window.RufloResearchWidget` with `init(containerId)` and `version` for programmatic control. See [`docs/WIDGET-INTEGRATION.md`](docs/WIDGET-INTEGRATION.md) for the full integration guide.

## Tech Stack

React 18 · TypeScript 5 · Vite 5 · Tailwind 3 · shadcn/ui · Radix UI · React Query · React Router · Hono (Node) + Google Cloud Functions · RVF (IndexedDB) + ruvector ONNX-WASM (MiniLM-L6, 384d) · GOAP A* planner · Playwright e2e

## Browser Persistence (RVF + ruvector ONNX-WASM)

Per [ADR-093](../docs/adr/ADR-093-goal-ui-ruvector-wasm.md), persistent client state lives in the browser via the **RuFlo Vector Format (RVF)** — a binary file format compatible with the Node `RvfBackend`, stored in IndexedDB through the [`idb`](https://www.npmjs.com/package/idb) wrapper.

| Feature | Detail |
|---|---|
| Format | RVF v1 (`magic = "RVF\0"`, header JSON + entries) — same byte layout as `@claude-flow/memory/src/rvf-backend.ts` |
| Storage | IndexedDB (`ruflo-research-rvf` v1, `entries` ObjectStore + `key` / `namespace` indexes) |
| Embedder | [`ruvector-onnx-embeddings-wasm`](https://www.npmjs.com/package/ruvector-onnx-embeddings-wasm) — MiniLM-L6, 384-dim, L2-normalized, lazy-loaded |
| Search | Cosine similarity (linear scan, ~4 ms at 10K × 384 fp32) |
| Hardening | 256 KB per-entry size cap · `MAX_DIMENSIONS=10000` · vector-dim ≠ header rejected · header-truncation check |
| Performance | p95 write 0.3 ms · p95 read 0.2 ms (167× / 50× DoD headroom) |

Persisted slots today: `widgetConfig` · `userGoal` · `researchConfig`. Toggle via `VITE_RVF_ENABLED=true`.

> ⚠️ **WASM dependencies are pinned to exact versions.** Upgrades require a Step-22d-style audit of supply chain + browser CSP envelope. See [`docs/audit-known-issues.md`](docs/audit-known-issues.md).

## Functions Backend (LOCAL_FN + GCF)

The 4 wired AI workflows (research-goal generation, per-step research, action-item synthesis, config optimization) run as framework-agnostic Node handlers wrapped under either:

- **Local dev** — Hono on `:8787` (`npm run functions:dev`), CORS allowlist, X-RuFlo-Token check, 60 req/min per-IP rate limit
- **Production** — Google Cloud Functions (entrypoints in `functions/<name>/index.ts`)

Each handler validates LLM tool-call output via Zod and wraps user input in `<user_input>...</user_input>` delimiters (close-tag injection stripped). Malformed model output → 502 (no leakage of unsafe content).

## Quality Gates

```bash
npm run check:secrets          # API-key shape scanner across src/, dist/, public/, …
npm run check:audit            # npm audit --audit-level=critical (deploy block)
npm run check:audit:high       # awareness gate — surfaces high vulns (non-blocking)
npm run check:handler-fallback # 4 handlers × Zod schema neg tests + sanitizer test
npm run check:rvf-format       # 5 negative + 5 happy-path RVF deserializer tests
npm run check:fn-security      # 401/CORS-empty/429 enforcement (server must be running)
npm run test:e2e               # Playwright suite (22 tests; smoke + ui + workflows + persistence + widget)
```

`postbuild` automatically runs `check:secrets` after every `npm run build`.

## Deployment

Hosted on Netlify (`netlify.toml`) at [goal.ruv.io](https://goal.ruv.io/). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for self-hosting instructions and edge-function deploy steps.

## Environment

Copy `example.env` → `.env`. **Public** vars are `VITE_*` prefixed and ship in the browser bundle. **Server-only** vars MUST never be `VITE_*` prefixed.

```bash
# === Public (VITE_-prefixed; safe in browser bundle) ===
VITE_RVF_ENABLED=false                      # toggle browser RVF persistence
VITE_FUNCTIONS_BASE_URL=http://localhost:8787   # LOCAL_FN dev / GCF prod URL
VITE_FUNCTIONS_PUBLIC_TOKEN=dev-token-change-me # weak abuse-control token

# === Server-only (NEVER VITE_-prefixed) ===
LOVABLE_API_KEY=...           # upstream LLM gateway key — set on functions host only
ANTHROPIC_API_KEY=...         # alternative direct LLM provider — host-only
RUFLO_FUNCTIONS_TOKEN=...     # production override of public token (validated server-side)
RUFLO_ALLOWED_ORIGINS=...     # CSV CORS allowlist (defaults: localhost:8080,goal.ruv.io)
RUFLO_RATE_LIMIT_PER_MIN=60   # per-IP token bucket
```

Per [ADR-093 §S1](../docs/adr/ADR-093-goal-ui-ruvector-wasm.md), the `VITE_*` rule is enforced by `npm run check:secrets`: any `VITE_*=key-shape` assignment fails the build.

## License

MIT — same as the parent [RuFlo](https://github.com/ruvnet/ruflo) project.
