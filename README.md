# History Effects

A map for learning how history connects, built on a **curated database** rather than an LLM's improvisation.

The skeleton is about 6,000 of history's most significant wars, battles, revolutions, treaties, states, leaders, thinkers, inventions, ideas and eras. They come from Wikidata, ranked by how many language editions of Wikipedia cover them, so the map shows the high-order bits rather than every skirmish. The links between them are cause-and-effect claims found in Wikipedia's *Background/Causes* and *Aftermath/Legacy* sections and in Wikidata. Cheap Haiku agents reviewed each link, kept about a third, and wrote a one-line mechanism for each survivor. Every link in the app shows its evidence. An LLM fills gaps only when asked, and is labeled when it does.

- **Atlas.** Browse by age × region × lens (for example "1840s · Europe · Revolutions"), with each slice ranked by significance. Put a slice on the map to see how its events connect.
- **Timeline map.** Left to right is time, and causes sit before their effects. Opening an event brings its sourced causes and effects with it.
- **Connect.** "How did the Treaty of Versailles lead to the Cold War?" finds the strongest chain of sourced links between two events.
- **Evidence everywhere.** Click a link to read the Wikipedia passage it comes from (with a link to the section), the reviewed mechanism, and an optional in-depth AI explanation.
- **Context.** Each event shows its Wikipedia summary and its structure: part of, includes, participants, preceded by, succeeded by.

How the database is built is described in [`pipeline/README.md`](./pipeline/README.md).

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
├── data/             — the curated database (committed; built by /pipeline)
├── pipeline/         — Wikidata + Wikipedia ingestion, scoring, review
├── docs/
│   ├── SPEC.md       — product + technical spec
│   └── PROGRESS.md   — running build log
├── server/           — Bun + Hono API (atlas queries + LLM fallback)
└── web/              — React Flow frontend
```

## Setup

### Quick start

```bash
bun run dev        # installs deps if needed, starts API + web, Ctrl-C stops both
bun run dev:mock   # same, but always with canned AI responses
```

Then open http://localhost:5173. Without an `OPENROUTER_API_KEY` in `server/.env` it falls back to mock AI automatically; the atlas works fully either way.

### Manual: 1. Backend

```bash
cd server
cp .env.example .env
# put your OpenRouter key into .env (OPENROUTER_API_KEY=...)
bun install
bun run dev
```

The API listens on `http://localhost:3000`.

The atlas (browse, search, sourced links, paths) needs no API key. The key is only for AI features: explanations, and gap-filling beyond the database. Without one, `bun run dev:mock` serves canned AI responses so the whole UI works offline.

### Manual: 2. Frontend

```bash
cd web
bun install   # or npm install
bun run dev   # or npm run dev
```

Open http://localhost:5173.

## Using the app

1. Search for an event, person, state or idea. Suggestions come from the database as you type. Opening one adds it to the timeline with its sourced causes and effects.
2. Or open **Atlas** (<kbd>A</kbd>), pick an age, era, region and lens, and browse the ranked list. **Map the top 12** puts that slice on the map and draws every sourced link among its events.
3. Click an event to read its Wikipedia summary, its sourced causes and effects (ones not yet on the map are one click away), and its context. **What caused this? / What did it lead to?** add the next sourced links. When the database runs out, the AI is asked, and its additions are marked **AI**.
4. Click or hover a link to see its evidence: the Wikipedia passage, a Wikidata claim, or the reviewed mechanism. **Explain this connection in depth** asks the AI for mechanism, co-factors, debate and counterfactual. **Show the steps in between** finds an indirect sourced chain.
5. **Connect** (or type "How did X lead to Y?") traces the strongest sourced chain between two events, and falls back to the AI if none exists. You can also drag from an event's right edge onto another event.
6. Keyboard: arrows walk along the chain, <kbd>E</kbd>/<kbd>C</kbd> expand, <kbd>X</kbd> explains a link, <kbd>A</kbd> opens the atlas, <kbd>F</kbd> fits the map, <kbd>Z</kbd> undoes, <kbd>?</kbd> shows everything.

The map is saved in browser `localStorage`.

## Endpoints

Curated database (no API key needed):

| Method | Path | Query | Returns |
|--------|------|-------|---------|
| GET | `/api/atlas/meta` | | lens and region counts, totals |
| GET | `/api/atlas/search` | `q`, `limit?` | entities ranked by match and significance |
| GET | `/api/atlas/browse` | `from`, `to`, `region?`, `lens?`, `limit?` | the most significant entities of a time window |
| GET | `/api/atlas/entity/:id` | | entity, sourced causes and effects (with evidence), neighbors, structure |
| GET | `/api/atlas/path` | `from`, `to`, `skipDirect?` | strongest sourced chain (`reversed` if the second came first) |

AI fallback (OpenRouter):

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
