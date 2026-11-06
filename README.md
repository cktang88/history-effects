# History Effects

A map for learning how history connects. Start from any event and follow what it set in motion (and what set it in motion), or ask how two moments are connected and get the causal chain between them. Every link explains *how* one thing led to another.

- **Timeline map.** Left to right is time; causes sit before their effects. Nearby years share a column, and the ruler marks the gaps between periods.
- **Explore.** Type an event and get the event, its major effects, and its causes in one pass. Items stream in one by one, most important first.
- **Connect.** Ask "How did the Black Death lead to the Reformation?" (or `X -> Y`) and get the step-by-step chain, a verdict on how strong the connection is, and the story in plain words.
- **Convergence.** When a new effect is an event already on the map, it links to that node instead of duplicating it, so separate threads visibly converge.
- **Read the links.** Hover any link for its mechanism. Click it for an in-depth explanation: how it worked, what else it took, what historians debate, and what likely happens without it. "Show the steps in between" expands a link into a chain.
- **Focus.** Selecting an event lights up its whole lineage (everything upstream and downstream) and dims the rest.

Links are weighted by causal strength: **primary** (direct, near-necessary, thick line), **contributing** (one of several factors), **minor** (peripheral or debated, dashed).

## Stack

- **Backend**: Bun + Hono, calling [OpenRouter](https://openrouter.ai/) through `@openrouter/sdk`.
- **Frontend**: React 19 + [React Flow 12](https://reactflow.dev/) (`@xyflow/react`) + Vite.
- **Tests**: Vitest in both packages (70 tests total).
- **Lint**: oxlint at the repo root.
- **Pre-commit**: [prek](https://github.com/j178/prek) runs oxlint + tests via `.pre-commit-config.yaml` before every commit.
- **Default model**: `moonshotai/kimi-k2.6` (override via `OPENROUTER_MODEL` env var).

## Project layout

```
history-effects/
├── docs/
│   ├── SPEC.md       — product + technical spec
│   └── PROGRESS.md   — running build log
├── server/           — Bun + Hono API
└── web/              — React Flow frontend
```

## Setup

### 1. Backend

```bash
cd server
cp .env.example .env
# put your OpenRouter key into .env (OPENROUTER_API_KEY=...)
bun install
bun run dev
```

The API listens on `http://localhost:3000`.

No key yet? `bun run dev:mock` serves canned, streamed responses (with realistic data for the Black Death and the printing press) so you can try the whole UI offline.

### 2. Frontend

```bash
cd web
bun install   # or npm install
bun run dev   # or npm run dev
```

Open http://localhost:5173.

## Using the app

1. Type an event (or pick a starter) and press **Explore**. The event, its effects, and its causes stream onto the timeline.
2. Click any event to open it: description, everything it caused, everything that caused it, each with its mechanism. **What caused this? / What did it lead to?** grow the map (later clicks find *more*, never duplicates).
3. Click or hover a link to read why it holds. **Explain this connection in depth** gives the mechanism, co-factors, the debate, and a counterfactual. **Show the steps in between** expands the link into a chain.
4. Use **Connect** (or type "How did X lead to Y?") to trace a causal chain between any two events, existing or new. You can also drag from an event's right edge onto another event.
5. **Verify with web sources** re-checks an event's details using OpenRouter web search (the only place web search is used).
6. Keyboard: arrows walk along the chain, <kbd>E</kbd>/<kbd>C</kbd> expand, <kbd>X</kbd> explains a link, <kbd>F</kbd> fits the map, <kbd>Z</kbd> undoes, <kbd>?</kbd> shows everything.

The map is saved in browser `localStorage`, and API responses (including their streamed items) are cached by stable request key, so reloading or repeating a question is instant.

## Endpoints

| Method | Path           | Body                                                  | Returns |
|--------|----------------|-------------------------------------------------------|---------|
| POST   | `/api/explore` | `{ text, n? }`                                        | `{ event, effects[], causes[] }` |
| POST   | `/api/effects` | `{ event, n?, context?: { path?, existing?, exclude? } }` | `{ effects: CausalItem[] }` |
| POST   | `/api/causes`  | same as effects                                       | `{ causes: CausalItem[] }` |
| POST   | `/api/path`    | `{ from: event \| text, to: event \| text }`          | `{ from, to, steps: CausalItem[], final, verdict, summary }` |
| POST   | `/api/explain` | `{ cause, effect, reasoning? }`                       | `{ mechanism, keyFactors[], certainty, debate, counterfactual }` |
| POST   | `/api/seed`    | `{ text }`                                            | `{ event }` |
| POST   | `/api/enrich`  | `{ event }`                                           | `{ event }` (web-search-verified) |
| POST   | `/api/bridge`  | `{ from, to }`                                        | `{ intermediate, fromStrength, toStrength, reasoning }` |

An event is `{ title, description, year?, endYear?, dateLabel?, place?, domain? }` (`year` is an integer, negative for BCE). A `CausalItem` adds `strength` and `reasoning` (the mechanism). `context` gives the model the chain the learner followed, events already on the map (so it reuses their exact titles), and titles to avoid repeating.

Every endpoint also has an SSE variant at `/api/<name>/stream`, emitting:

- `item`: `{ key, index, value }` as soon as each object (the event, each effect/cause/step) is complete in the model's output.
- `thinking`: reasoning text deltas, when the model provides them.
- `token`: raw model text deltas.
- `result`: the parsed, sanitized final payload.
- `error`: an error payload if generation fails.

## LLM behavior

- Prompts ask for what a strong survey course would emphasize, ordered by importance, with accurate dates, named concrete developments, calibrated strength, and explicit mechanisms; effects must come after the event and causes before it.
- Reasoning effort is set by `OPENROUTER_REASONING` (default `low`; `off`/`minimal`/`medium`/`high` also work).
- Requests use OpenRouter JSON mode via `responseFormat: { type: "json_object" }`.
- Prompts explicitly include the expected JSON shape, matching Kimi JSON Mode guidance.
- Non-streaming calls enable OpenRouter's `response-healing` plugin.
- If parsing still fails, the server performs a second JSON-repair request and parses the repaired output.
- Prompt caching is enabled with OpenRouter `cache_control: { type: "ephemeral" }` on the request and the system prompt content block.
- CLI and frontend SSE calls stream tokens for responsiveness, then use the parsed final JSON.
- Full LLM logs are written as JSON files in `server/logs/`, including request payloads, raw SDK responses or stream chunks, parsed output, repair attempts, usage, and any `reasoning` / `reasoningDetails` fields OpenRouter returns. Streaming calls also write a separate `*-trajectory.json` file with the ordered chunk/token/reasoning trajectory. This directory is git-ignored. Logging is skipped under Vitest and can be disabled with `OPENROUTER_LOGS=0`.

## CLI (test LLM funcs without the frontend)

The server ships a CLI that calls the same prompt helpers as the HTTP routes — useful for iterating on prompts without launching the web app. Requires `server/.env` with `OPENROUTER_API_KEY`.

```bash
cd server
bun run cli seed    "Seven Years' War"
bun run cli effects "French Revolution" --n 5
bun run cli causes  "World War I"
bun run cli bridge  "Steam engine" "Industrial Revolution"
bun run cli all     "Sputnik launch"
```

The CLI is split into a pure `parseArgs` + `runCommand(cmd, deps)`, both unit-tested in `server/src/cli.test.ts`.

## Style

See [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md) for the conventions this repo follows (React Compiler, no manual memoization, small composable functions, async/await, testable CLIs, etc.).

## Tests / lint / hooks

```bash
# from repo root, install root-level dev tools (oxlint + simple-git-hooks)
bun install

# run lint + tests across both packages (also what the pre-commit hook runs)
bun run precommit

# individually
bun run lint
bun run test
```

The pre-commit hook is managed by [prek](https://github.com/j178/prek). After cloning, install prek (`brew install j178/tap/prek`) and run `prek install` once to register the git hook. Config lives in `.pre-commit-config.yaml`.

See [`docs/SPEC.md`](./docs/SPEC.md) for the full spec and [`docs/PROGRESS.md`](./docs/PROGRESS.md) for the build log.
