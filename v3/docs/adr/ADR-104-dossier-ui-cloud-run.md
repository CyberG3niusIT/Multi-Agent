# ADR-104: Dossier UI at `dossier.ruv.io` on GCP Cloud Run

**Status**: Proposed
**Date**: 2026-05-04
**Version**: target v3.6.x (additive)
**Supersedes**: nothing
**Related**: ADR-099 (dossier-investigator agent + skill), ADR-094 (goal_ui shared security primitives), ADR-101 (grounded research / Anthropic+Vertex), `v3/goal_ui/` (sibling app at `goal.ruv.io`)

## Context

ADR-099 added the `dossier-collect` skill and `dossier-investigator` agent in `plugins/ruflo-goals`, producing JSON dossier graphs (3 example dossiers under `v3/docs/examples/dossiers/`). Today these are static files. We want a hosted viewer at **`dossier.ruv.io`** with a CIA-style classified-document aesthetic.

`goal_ui` is already running on **GCP Cloud Run** (live: `https://ruflo-research-fns-vi6poqcldq-uc.a.run.app`, mapped to `goal.ruv.io`). The architecture (per the unmerged `feat/goal_ui-ruvector-wasm` branch and ADR-094) is:

- **Single Cloud Run service** boots via `npm start` → `tsx functions/server.ts` (Hono)
- **Same-origin SPA + API**: SPA at `/` (from `dist/`), handlers at `/functions/v1/<name>`
- **Buildpacks** detect Node + Cloud Run scale-to-zero — no Dockerfile
- **Security stack** (ADR-094): CORS allowlist (`RUFLO_ALLOWED_ORIGINS`), `X-RuFlo-Token` header check, per-IP token bucket (60 req/min)
- **Secret Manager**: `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `brain-api-key`, `RUFLO_FUNCTIONS_TOKEN`
- **Min instances = 1** (no cold-start on public domain)

We mirror this pattern rather than diverge.

## Decision

Add a new workspace package `v3/dossier_ui/` deployed as a **second Cloud Run service** (`ruflo-dossier-fns`) mapped to `dossier.ruv.io`.

### Reuse map (existing GCP infra)

| Existing | Reused as | How |
|---|---|---|
| Hono `functions/server.ts` security pattern | Copied with same env vars | CORS+token+rate-limit kept identical |
| Secret Manager secrets | Same secrets, same names | `ANTHROPIC_API_KEY` etc. shared via `--set-secrets` |
| `goal_ui`'s `_lib/llm`, `_lib/sanitize`, `_lib/secrets`, `_lib/grounding` | Workspace dep (`@ruflo/research`) — direct import once goal_ui-ruvector merges | Phase 1 copies the patterns; Phase 2 imports |
| `goal_ui` `/functions/v1/research-step` etc. | Called cross-origin from dossier UI for any AI ops needed | Add `https://dossier.ruv.io` to `RUFLO_ALLOWED_ORIGINS` of goal_ui |
| GCP project, region (`us-central1`), Cloud Build | Same project / region | `gcloud config get-value project` |
| Cloud Run min-instances=1 pattern | Same | Identical deploy flags |

### Why a second service vs one service serving both domains

Considered. Rejected because:
- **Independent deploys**: dossier UI iteration shouldn't trigger goal_ui restarts and vice versa.
- **Independent rollback**: blast radius isolation.
- **Independent scale**: dossier UI is mostly static + light reads; goal_ui is API-heavy.

The cost of a second service is ~$5/mo at min-instances=1 — acceptable.

### Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Build | Vite + React + TS | Mirror `goal_ui` |
| Routing | `react-router-dom` v6 | SPA |
| Styling | Plain CSS + CSS variables (CIA theme) | No Tailwind v1 — fewer moving pieces |
| Graph | `mermaid` | Same syntax used in markdown dossiers |
| Server | Hono + tsx | Mirror `goal_ui` |
| Workspace dep | `"@ruflo/research": "workspace:*"` | Symbolic v1; real imports in v2 |
| Hosting | Cloud Run (`ruflo-dossier-fns`) | Mirrors goal.ruv.io infra |
| Domain | `dossier.ruv.io` via Cloud Run domain mapping | DNS owned by user |

### CIA-style theme tokens

```css
--bg: #0a0e0a;          /* near-black with green tint */
--surface: #0f1410;
--ink: #c8c8b8;         /* aged-paper white */
--accent: #ffb000;      /* CRT amber */
--classified: #c41e3a;  /* TS/SCI red */
--mono: "IBM Plex Mono", monospace;
--scanline: repeating-linear-gradient(0deg, rgba(255,176,0,0.03) 0 1px, transparent 1px 3px);
```

Visual: CLASSIFIED header bar, redaction blocks, dossier-folder framing, monospace everything, subtle scanline overlay.

### Pages

| Route | Purpose |
|---|---|
| `/` | Index — list dossiers (stamps, metadata, redaction effect on hover) |
| `/d/:slug` | Viewer — entity table, mermaid graph, source provenance |
| `/about` | Briefing — link to ADR-099, ADR-104, mission statement |

### Dossier pipeline

1. `scripts/sync-dossiers.mjs` copies `v3/docs/examples/dossiers/**` → `public/dossiers/` at build
2. App fetches `/dossiers/index.json` (generated list) on load
3. Viewer fetches `/dossiers/<slug>/<slug>.json` on demand

Static-first. Server-side dossier generation (calling out to `goal.ruv.io`'s `/functions/v1/research-step`) is gated to Phase 2.

## Consequences

### Positive
- Dossiers get a real UI; team shares `dossier.ruv.io/d/ruvnet` links
- Reuses 100% of goal_ui's GCP security stack (CORS, token, rate limit, Secret Manager)
- Independent deploy/rollback/scale
- CIA aesthetic is visually distinctive

### Negative
- Two Cloud Run services — operational surface +1 (~$5/mo)
- Workspace dep on `@ruflo/research` is symbolic v1 (real shared-lib imports require either: (a) merging `feat/goal_ui-ruvector-wasm`, OR (b) adding `exports` in goal_ui package.json). Tracked as Phase 2.
- DNS for `dossier.ruv.io` requires user DNS access — not handled in this ADR

### Neutral
- ADR numbering crosses 100 deliberately to avoid the `feat/goal_ui-ruvector-wasm` range (ADR-094..103)
- Hono server is empty for v1 (just SPA serve); handlers added when AI ops are needed

## Implementation

| Step | Artifact | Status |
|---|---|---|
| 1 | `v3/dossier_ui/package.json` (Vite + Hono + tsx + workspace dep) | scaffolding |
| 2 | `v3/dossier_ui/functions/server.ts` (Hono + security stack) | scaffolding |
| 3 | `v3/dossier_ui/src/` (App, theme, pages, components) | partial |
| 4 | `v3/dossier_ui/scripts/sync-dossiers.mjs` (copy from `v3/docs/examples/`) | scaffolding |
| 5 | `v3/dossier_ui/scripts/gcp-deploy-cloudrun.sh` (mirror goal_ui's) | scaffolding |
| 6 | `v3/dossier_ui/.gcloudignore` (mirror goal_ui's) | scaffolding |
| 7 | Local validation (`npm run dev` + agent browser, zero console errors) | pending |
| 8 | Root README link in goal section | pending |
| 9 | DNS + `gcloud deploy` runbook in `v3/dossier_ui/docs/DEPLOYMENT.md` | pending |

## Acceptance

- [ ] `cd v3/dossier_ui && npm install && npm run dev` starts cleanly
- [ ] Browser test: index lists 3 dossiers; viewer renders entity table + graph; **zero console errors**
- [ ] `npm run build` produces deployable `dist/`
- [ ] `npm start` boots Hono server; `curl localhost:8787/healthz` returns OK
- [ ] `scripts/gcp-deploy-cloudrun.sh` lints (`bash -n`)
- [ ] Root README has dossier link with emoji + 1-line description
- [ ] ADR-104 committed

## Out of scope

- Actual `gcloud run deploy` (requires user auth)
- DNS configuration for `dossier.ruv.io`
- Shared component library extraction from goal_ui (Phase 2)
- Authentication / private dossiers (v2)
