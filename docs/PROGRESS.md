# Progress log

Running build log. Newest entry on top.

---

## 2026-04-27 — v0.1 scaffold complete

**Decisions**
- Backend: Bun + Hono.
- Frontend: React 19 + Vite + `@xyflow/react` (React Flow 12).
- LLM: OpenRouter, default model `moonshotai/kimi-k2-thinking` (configurable via `OPENROUTER_MODEL`).
- Bridge UX: drag-edge between two nodes triggers intermediate generation (with placeholder node + edges while the model runs).
- API key supplied via `server/.env` (`OPENROUTER_API_KEY`).
- Persistence: none in v1; graph lives in browser memory.

**Status**
- [x] git init, author set to Kwuang Tang <arctangent20@yahoo.com>
- [x] README.md
- [x] docs/SPEC.md
- [x] docs/PROGRESS.md
- [x] Backend scaffold
  - [x] Hono app with `/api/seed`, `/api/effects`, `/api/causes`, `/api/bridge`
  - [x] OpenRouter client (`response_format: json_object` + loose JSON fallback)
  - [x] System prompts with shared strength rubric
  - [x] CORS, error handler, sanitization, n-clamping
- [x] Frontend scaffold
  - [x] React Flow 12 canvas with custom `EventNode` and `CausalEdge`
  - [x] Color-coded edges by strength (red/amber/gray, gray dashed for minor)
  - [x] Top-bar seed input → `/api/seed`
  - [x] Per-node Effects / Causes buttons → `/api/effects`, `/api/causes`
  - [x] Drag-edge `onConnect` → optimistic placeholder + `/api/bridge`
    - If model returns `intermediate: null`, placeholder is removed and a direct edge is drawn instead.
  - [x] Right-side detail panel showing reasoning for selected edge / event
  - [x] Legend chips in top bar
  - [x] Error banner
- [x] Install deps, type-check both packages, vite build, backend smoke test

**Verified**
- `bun install` clean in `server/` and `web/`.
- `tsc --noEmit` clean in both packages.
- `vite build` succeeds (~385 kB JS, ~123 kB gzip).
- `bun run src/index.ts` starts on :3000; routes return expected error JSON when `OPENROUTER_API_KEY` is missing.

**Open / future**
- [ ] Manual test against a real OpenRouter key (Kimi 2.6).
- [ ] Verify Kimi 2.6's JSON adherence; tighten prompts if it drifts.
- [ ] Optional: streaming responses for faster perceived latency.
- [ ] Optional: persistence (save/load JSON).
- [ ] Optional: dagre auto-layout when graph gets dense.
- [ ] Optional: Wikipedia / source links per node.

---

## 2026-04-27 — tests, lint, pre-commit hook

**Changes**
- Default OpenRouter model bumped to `moonshotai/kimi-k2.6`.
- Refactored `server/src/index.ts`: helpers moved to `helpers.ts`, `app` exported for tests, `parseJSONLoose` exported from `openrouter.ts`.
- Added Vitest to both packages.
- Added oxlint at the repo root (`bun run lint` lints both `server/src` and `web/src`).
- Added `simple-git-hooks` pre-commit hook that runs `bun run precommit` (lint + tests in both packages).

**Tests**
- `server/src/helpers.test.ts` — 14 tests covering `clampN`, `normalizeStrength`, `sanitizeList`, `renderEventPrompt`.
- `server/src/openrouter.test.ts` — 7 tests covering `parseJSONLoose` (clean JSON, fenced JSON, JSON-in-prose, nested braces, error path).
- `server/src/index.test.ts` — 15 tests covering all four routes (`/api/seed`, `/api/effects`, `/api/causes`, `/api/bridge`) including: happy paths, validation 400s, malformed-model 502, n-cap, strength normalization, intermediate=null, missing-API-key error.
- `web/src/api.test.ts` — 7 tests covering all four client wrappers (`seedEvent`, `generateEffects`, `generateCauses`, `generateBridge`) with mocked global `fetch`.

**Verified**
- `bun run lint`: 0 warnings, 0 errors across 15 files.
- `bun run test`: 43 / 43 passing (server 36, web 7).
- Pre-commit hook installed at `.git/hooks/pre-commit`.
