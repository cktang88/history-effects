# History Effects — Spec

## Goal

A canvas for exploring historical events as a directed causal graph. Each node is an event; each edge is a causal claim with a strength label. Users can grow the graph in three directions:

1. **Forward** — generate downstream effects of an event.
2. **Backward** — generate upstream causes of an event.
3. **Bridge** — given two events A and B, generate an intermediate event such that A → intermediate → B.

The graph supports fractal exploration: every effect/cause/intermediate is itself a full event node that can be expanded further.

## Domain model

### Event (node)

```ts
type EventNodeData = {
  title: string;        // 4–10 word headline
  description: string;  // 2–3 sentence factual description
  loading?: boolean;    // true while LLM is filling this in (placeholder)
};
```

### Causal link (edge)

```ts
type Strength = "primary" | "contributing" | "minor";

type CausalEdgeData = {
  strength: Strength;
  reasoning?: string;   // 1–2 sentences from the model on why this link
};
```

### Strength definitions (same wording used in prompts)

- **primary** — Direct, near-necessary cause. Without the source event, the consequence likely doesn't occur, or occurs much later / differently.
- **contributing** — One of several meaningful factors. The consequence had multiple causes.
- **minor** — Peripheral or speculative contribution. The connection is plausible but distal or weak.

### Visual mapping

| Strength      | Color    | Stroke    |
|---------------|----------|-----------|
| primary       | `#dc2626` (red)    | 3px solid |
| contributing  | `#f59e0b` (amber)  | 2px solid |
| minor         | `#6b7280` (gray)   | 1.5px dashed |

## User flow

### Seeding

- Top-bar input: free-form text like "Seven Years' War" or "the printing press".
- Submit → `POST /api/seed` returns a cleaned-up `{title, description}`. A node appears at the canvas center.

### Expanding effects / causes

- Each node has two buttons: **→ Effects** and **← Causes**.
- Click → node enters `loading` state → `POST /api/effects` (or `/api/causes`) returns up to N items.
- Children are placed in a horizontal fan: effects below the source, causes above. Spacing: ~280 px x, 220 px y.
- Each child is a new node; the edge carries the `strength` and `reasoning` returned by the model.

### Bridging two events (drag-edge UX)

- User drags an edge from node A's bottom handle to node B's top handle.
- On `onConnect`, frontend:
  1. Inserts a placeholder intermediate node midway between A and B (loading=true).
  2. Inserts two placeholder edges: A → mid, mid → B.
  3. `POST /api/bridge` with `{ from: A, to: B }`.
  4. On response, replaces placeholder content; sets edge strengths and reasoning.
  5. If the model returns `intermediate: null`, the placeholder is removed and a single direct edge between A and B is left in place (still color-coded, treated as a direct claim from the model).

### Edge inspection

- Clicking an edge opens a small popover showing `strength` and `reasoning`.
- Edge labels show the strength as a small chip.

### Deletion

- Selected node + <kbd>Backspace</kbd> deletes the node and its edges (React Flow built-in).

## API

All endpoints are `POST` with JSON. All return JSON. Errors return `{ error: string }` with HTTP 4xx/5xx.

### `POST /api/seed`

```ts
// Request
{ "text": "the seven years war" }

// Response
{ "event": { "title": "Seven Years' War (1756–1763)", "description": "Global conflict ..." } }
```

### `POST /api/effects`

```ts
// Request
{ "event": { "title": "...", "description": "..." }, "n": 5 }

// Response
{
  "effects": [
    { "title": "...", "description": "...", "strength": "primary", "reasoning": "..." },
    ...
  ]
}
```

### `POST /api/causes`

Symmetric to `/api/effects` — returns upstream causes.

### `POST /api/bridge`

```ts
// Request
{
  "from": { "title": "...", "description": "..." },
  "to":   { "title": "...", "description": "..." }
}

// Response
{
  "intermediate": { "title": "...", "description": "..." } | null,
  "fromStrength": "primary" | "contributing" | "minor",
  "toStrength":   "primary" | "contributing" | "minor",
  "reasoning": "..."
}
```

## System prompts (summary — full text in `server/src/prompts.ts`)

### Effects / causes

The model is told to:
- Distinguish direct effects from background trends.
- Vary time horizons (immediate / medium / long-term) and domains (political, economic, military, social, technological, cultural, demographic, ideological).
- Keep each effect a discrete development, not a vague trend.
- Be calibrated about causal certainty.
- Classify each link as primary / contributing / minor using the definitions above.
- Return strict JSON.

### Bridge

The model is told to:
- Find an intermediate that A meaningfully caused and that meaningfully caused B.
- Return `null` if no plausible link exists, with a reasoning explanation.
- Classify both legs of the chain.
- Return strict JSON.

## Configuration

`server/.env`:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=moonshotai/kimi-k2.6
PORT=3000
```

`OPENROUTER_MODEL` accepts any OpenRouter model slug.

## Non-goals (v1)

- No persistence — graph lives in browser memory.
- No auth / multi-user.
- No streaming responses.
- No source citations (the model speaks from its own knowledge).
- No undo/redo beyond React Flow's selection/delete.

## Future ideas

- Save/load graphs as JSON.
- Stream tokens for faster perceived response.
- "Why?" button on edges → expand the link itself into a sub-graph.
- Citations / Wikipedia links per node.
- Auto-layout (dagre) when graph gets dense.
