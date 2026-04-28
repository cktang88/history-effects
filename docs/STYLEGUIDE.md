# Style Guide

These are the conventions for this repo. They were established in conversation; new code should follow them and existing code should be migrated when touched.

## React

- **React Compiler is enabled** (`babel-plugin-react-compiler` in `web/vite.config.ts`). Apply it everywhere — every component goes through the compiler.
- **Don't manually memoize.** No `useCallback`, no `useMemo`, no `React.memo`, no `useRef`-as-stale-closure-workaround. The compiler handles it.
  - `useState`, `useReducer`, `useContext`, custom hooks — still fine.
  - `useRef` is still fine for **DOM refs** and for genuinely mutable, non-reactive state. Just don't reach for it to "fix" closures.
- **No direct `useEffect` in components.** Enforced by the [`no-use-effect`](../.claude/skills/no-use-effect/SKILL.md) skill. Derive state instead of syncing it; use data-fetching libraries; use event handlers for user actions; use `key` for reset; use `useSyncExternalStore` for external stores. The only place `useEffect` may appear is inside a reusable custom hook (e.g. a `useMountEffect`). See the skill's SKILL.md for the 6 rules and patterns.
- Inline event handlers are fine — the compiler stabilizes them.
- For "always-fresh state" inside a callback, prefer reading state via the relevant store/hook (e.g. `useReactFlow().getNodes()`) over manual refs.

## Functions

- **Small and composable.** Each function does one thing. Prefer many short helpers over one long handler.
- **No deep nesting.** Early returns, extract helpers. If you're more than ~3 levels deep, pull something out.
- **Pure helpers go to module scope** (e.g. `placeholderNode`, `eventOf`, `fanPosition`). They don't need to be inside the component.
- **Async/await over Promises and callbacks.** Don't chain `.then().catch()` when `try/await/catch` reads cleaner. Use `.then`/`.catch` only at the outer "fire and forget" boundary.

## State updates

- Always use functional updates (`setNodes((ns) => ...)`) when the new value depends on the previous.
- Prefer narrow update helpers (`updateNode(id, patch)`, `removeNode(id)`) over inlining `.map(...)` filters at every call site.

## Errors

- Wrap user-facing async work in a single `guard()` (or equivalent) so error handling isn't repeated. Surface errors via state, not `alert`/`console`.
- At system boundaries (HTTP, CLI args, LLM output) validate; inside trusted internal code, don't add defensive checks.

## CLI / scripts

- **Separate parsing, business logic, and I/O.** A CLI should expose a pure `parseArgs` and a pure `runCommand(cmd, deps)` that takes its dependencies (LLM calls, fs, etc.) as arguments. The `if (import.meta.main)` block wires real deps in.
- That separation is what makes the CLI **unit-testable** without mocking the network. New CLIs ship with tests.

## Code organization

- Group by **product feature**, not by technical type (e.g. `features/inventory/*`, not `hooks/*` + `components/*`).
- Reuse existing components (`components/ui/*`) before creating new ones.
- Keep state shapes shallow and easily modifiable.

## Comments

- Default to no comments. Add one only when the **why** is non-obvious (hidden constraint, subtle invariant, workaround).
- Don't restate what well-named code already says. Don't reference task numbers, fixes, or callers.

## LLM / OpenRouter

- LLM calls are server-side only.
- Models default to `moonshotai/kimi-k2.6` (override via `OPENROUTER_MODEL`).
- `reasoning: { effort: "medium" }` and the `web` plugin (web search) are enabled by default in `server/src/openrouter.ts`.

## Tests

- Vitest in both packages. New CLI commands, helpers, and routes get unit tests.
- Pre-commit hooks are managed by [prek](https://github.com/j178/prek) (`.pre-commit-config.yaml`); they run oxlint + tests across both packages before every commit.
