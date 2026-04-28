# History Effects

Explore historical events as a fractal graph of causes and consequences. Type an event, the LLM expands its main effects and causes, and you can keep drilling down — or drag an edge between any two events to have the LLM fill in an intermediate event that bridges them.

Edges are color-coded by causal strength: **primary** (direct, near-necessary cause), **contributing** (one of several factors), or **minor** (peripheral / speculative).

## Stack

- **Backend**: Bun + Hono, calling [OpenRouter](https://openrouter.ai/) for LLM completions.
- **Frontend**: React 19 + [React Flow 12](https://reactflow.dev/) (`@xyflow/react`) + Vite.
- **Tests**: Vitest in both packages (43 tests total).
- **Lint**: oxlint at the repo root.
- **Pre-commit**: simple-git-hooks runs `bun run precommit` (lint + tests) before every commit.
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

### 2. Frontend

```bash
cd web
bun install   # or npm install
bun run dev   # or npm run dev
```

Open http://localhost:5173.

## Using the app

1. Type a historical event in the input bar at the top, click **Add**. A node appears.
2. On any node, click **→ Effects** to fan out N consequences, or **← Causes** to fan out N upstream causes.
3. **Drag an edge** from one node's bottom handle to another node's top handle — the LLM proposes an intermediate event that bridges them, with both legs color-coded.
4. Click an edge to see the model's reasoning for the causal link.
5. Select a node and press <kbd>Backspace</kbd> to delete it.

## Endpoints

| Method | Path           | Body                                  | Returns |
|--------|----------------|---------------------------------------|---------|
| POST   | `/api/effects` | `{ event: {title, description}, n? }` | `{ effects: [{title, description, strength, reasoning}] }` |
| POST   | `/api/causes`  | `{ event: {title, description}, n? }` | `{ causes:  [{title, description, strength, reasoning}] }` |
| POST   | `/api/bridge`  | `{ from, to }`                        | `{ intermediate, fromStrength, toStrength, reasoning }` |
| POST   | `/api/seed`    | `{ text }`                            | `{ event: {title, description} }` (cleans up free-form input) |

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

The pre-commit hook is registered automatically by `simple-git-hooks` during `bun install` at the root. To skip it for a single commit (not recommended): `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`.

See [`docs/SPEC.md`](./docs/SPEC.md) for the full spec and [`docs/PROGRESS.md`](./docs/PROGRESS.md) for the build log.
