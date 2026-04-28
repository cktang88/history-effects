# Progress log

Running build log. Newest entry on top.

---

## 2026-04-28 — streaming, caching, opt-in web detail

**Changes**
- Replaced the hand-built OpenRouter HTTP client with `@openrouter/sdk`.
- Default generation no longer enables web search.
- Added `/api/enrich`, the explicit per-node web-search detail path.
- CLI calls now stream tokens to stderr while preserving parsed final JSON output.
- Added OpenRouter prompt caching (`cache_control: { type: "ephemeral" }`) on requests and system prompt content.
- Added OpenRouter `response-healing` plugin for non-streaming calls.
- Added server-side JSON repair retry when model output is malformed or truncated.
- Added browser `localStorage` graph persistence (`history-effects:graph:v1`).
- Added browser `localStorage` API response cache (`history-effects:api:*`) with stable request keys.
- Added SSE variants for all LLM endpoints at `/api/<name>/stream`.
- Frontend LLM actions now use SSE when they can display progress, showing transient raw JSON token previews on active nodes/placeholders.
- Added full JSON LLM logging under `server/logs/` and ignored that directory in git.
- Logs capture request payloads, raw SDK responses or stream chunks, parsed output, repair attempts, usage, and OpenRouter-returned `reasoning` / `reasoningDetails` fields when available.
- Streaming calls also write a separate `*-trajectory.json` file containing the ordered chunk/token/reasoning trajectory.
- Made normal Effects/Causes expansion idempotent for already-expanded directions.
- Added hover-only node controls:
  - **Web detail** enriches a node using web search.
  - **↻** removes downstream generated children and regenerates effects with cache bypass.

**Docs verified**
- Kimi JSON Mode docs recommend providing a specific JSON output example in the prompt, setting `response_format` to `{"type":"json_object"}`, and parsing `message.content` as serialized JSON.
- OpenRouter docs document `response_format: { type: "json_object" }` for JSON mode, `json_schema` for stricter structured outputs, the `response-healing` plugin, and plugin-based web search.

**Verified**
- `server`: `bun run typecheck`, `bun run test`, `bun run lint`.
- `web`: `bun run typecheck`, `bun run test`, `bun run lint`.
- `git diff --check`.

**Open / future**
- Consider moving from JSON object mode to `json_schema` for models where OpenRouter reports structured-output support.
- Add visible clear-cache / clear-graph UI controls.
- Add import/export graph JSON.
- Add a log viewer or tail command for `server/logs/`.

---

## 2026-04-27 — v0.1 scaffold complete

**Decisions**
- Backend: Bun + Hono.
- Frontend: React 19 + Vite + `@xyflow/react` (React Flow 12).
- LLM: OpenRouter, default model `moonshotai/kimi-k2.6` (configurable via `OPENROUTER_MODEL`).
- Bridge UX: drag-edge between two nodes triggers intermediate generation (with placeholder node + edges while the model runs).
- API key supplied via `server/.env` (`OPENROUTER_API_KEY`).
- Persistence: browser `localStorage` for graph state and API response cache.

**Status**
- [x] git init, author set to Kwuang Tang <arctangent20@yahoo.com>
- [x] README.md
- [x] docs/SPEC.md
- [x] docs/PROGRESS.md
- [x] Backend scaffold
  - [x] Hono app with `/api/seed`, `/api/enrich`, `/api/effects`, `/api/causes`, `/api/bridge`, plus `/stream` SSE variants
  - [x] OpenRouter SDK client (`response_format: json_object`, response healing, loose JSON fallback, repair retry)
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
- [x] Verify Kimi/OpenRouter JSON mode guidance and align prompts/request shape.
- [x] Optional: streaming responses for faster perceived latency.
- [x] Optional: persistence in browser storage.
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
- `server/src/openrouter.test.ts` — covers `parseJSONLoose`, SDK request shape, prompt caching, streaming, web-search plugin opt-in, and JSON repair retry.
- `server/src/index.test.ts` — covers all five routes (`/api/seed`, `/api/enrich`, `/api/effects`, `/api/causes`, `/api/bridge`) plus SSE behavior, including happy paths, validation 400s, malformed-model 502, n-cap, strength normalization, intermediate=null, missing-API-key error.
- `web/src/api.test.ts` — covers client wrappers plus browser response caching, refresh bypass, and SSE client parsing.

**Verified**
- `bun run lint`: 0 warnings, 0 errors across 15 files.
- `bun run test`: 70 / 70 passing (server 59, web 11).
- Pre-commit hook installed at `.git/hooks/pre-commit`.
