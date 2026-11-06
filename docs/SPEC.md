# History Effects — Spec

## Goal

Help a learner understand how history connects: what an event set in motion, what set it in motion, and how two distant events are linked, with every causal claim explained and weighted.

The canvas is a directed causal graph laid out on a timeline. Each node is a dated event; each edge is a causal claim with a strength and a mechanism. Users grow the graph by:

1. **Explore**: a phrase becomes an event plus its major effects and causes, in one streamed call.
2. **Expand**: effects (forward) or causes (backward) of any event. Repeat clicks find *more*, never repeats.
3. **Connect**: a multi-step causal chain from A to B (existing nodes or free text), with a verdict and summary ("story").
4. **Explain**: an in-depth explanation of one link (mechanism, co-factors, certainty, debate, counterfactual).
5. **Steps in between**: replace a direct link with the chain that explains it.

## Domain model

```ts
type Event = {
  title: string;
  description: string;
  year?: number;      // integer, negative = BCE; drives the timeline
  endYear?: number;
  dateLabel?: string; // display, e.g. "1789–1799", "c. 1440"
  place?: string;
  domain?: "political" | "military" | "economic" | "social" | "religious"
         | "cultural" | "scientific" | "technological" | "demographic" | "environmental";
};

type EventNodeData = Event & { row: number; verified?: boolean };

type CausalEdgeData = {
  strength: "primary" | "contributing" | "minor";
  reasoning?: string;        // the mechanism
  explanation?: Explanation; // filled by /api/explain
};

type Story = { id; fromId; toId; nodeIds; edgeIds; verdict?; summary? };
```

### Strength definitions (same wording used in prompts)

- **primary**: Direct, near-necessary cause. Without the source event, the consequence likely doesn't occur, or occurs much later / differently.
- **contributing**: One of several meaningful factors.
- **minor**: Peripheral, distal, or debated.

Visual encoding: line weight (primary thickest, minor dashed) plus a 3-bar strength meter in the inspector. Color is reserved for domain (card accent) and focus (lineage highlight).

## Layout

- x: ordinal time. Distinct years within 3 years of a cluster's start share a cluster; inside a cluster, causal order picks the sub-column (a cause is always left of its effect). The ruler labels each column and the gaps between clusters.
- y: each node has a persistent `row`. New neighbors fan into free rows around their anchor, then are re-sorted by year so their edges don't cross. Overlaps within a column are resolved by pushing apart and re-centering.
- Cards have a fixed height; zooming out below 0.6 switches them to large titles only.
- Positions tween over ~480 ms in JS so edges track the cards. New nodes spawn at their anchor and glide out.

## Interaction

- Click an event: select it, highlight its lineage, open the inspector (description, caused by / led to with mechanisms, traced chains it belongs to, trace-a-connection box, verify, remove).
- Click or hover a link: mechanism tooltip; inspector shows the pair, the time gap, strength, mechanism, explain, steps in between.
- Drag from an event's right edge onto another event: trace the chain between them.
- Keyboard: arrows navigate (left/right follow causes/effects), E/C expand, X explains a link, F fits, Z undoes, / searches, Esc deselects, Delete removes.
- Explore box also accepts "How did X lead to Y?" and "X -> Y".

## Persistence and caching

- Map (nodes, edges, stories) in `localStorage` under `history-effects:graph:v2`, written at most every 400 ms.
- Stream responses (items + result) cached under `history-effects:api:v2:*` and replayed on a cache hit.
- In-flight jobs are cancellable (HUD ×) via `AbortController`; removing a node aborts its job.

## API

See the endpoint table in the README. All endpoints are `POST` with JSON and have an SSE variant at `/api/<name>/stream` emitting `item` (`{key, index, value}` per completed object), `thinking`, `token`, `result`, and `error` events. Errors return `{ error }` with 4xx/5xx.

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

## OpenRouter / Kimi JSON handling

- The server uses `@openrouter/sdk` rather than hand-built `fetch` calls.
- The default model is `moonshotai/kimi-k2.6`.
- Requests use OpenRouter JSON mode with `responseFormat: { type: "json_object" }`.
- Prompts include explicit output examples and field meanings, matching Kimi's JSON Mode guidance.
- Non-streaming calls enable OpenRouter's `response-healing` plugin.
- If parsing still fails, `server/src/openrouter.ts` sends a second non-streaming repair request with temperature 0 and parses the repaired JSON.
- Prompt caching is enabled via OpenRouter `cache_control: { type: "ephemeral" }` on both the request and system prompt content part.
- Web search is not enabled by default; `/api/enrich` is the opt-in path that adds the `web` plugin.
- Full LLM logs are written to `server/logs/*.json` and git-ignored.
- Logs include request payloads, raw SDK responses or stream chunks, parsed output, repair attempts, usage, and any `reasoning` / `reasoningDetails` fields returned by OpenRouter.
- Streaming calls also write a sibling `*-trajectory.json` file with the ordered chunk/token/reasoning trajectory and a pointer back to the main log file.
- Logs are skipped under Vitest to avoid test-generated noise. Set `OPENROUTER_LOGS=0` to disable logging in other environments.
- Reasoning trace completeness depends on the upstream model/provider. Some models return reasoning details, summaries, or encrypted reasoning blocks; others return only final content and usage counts.

## Configuration

`server/.env`:

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=moonshotai/kimi-k2.6
PORT=3000
```

`OPENROUTER_MODEL` accepts any OpenRouter model slug.

## Non-goals

- No auth / multi-user.
- No server-side multi-user persistence.
- No automatic web search for normal generation.

## Future ideas

- Save/load graphs as JSON.
- "Why?" button on edges → expand the link itself into a sub-graph.
- Auto-layout (dagre) when graph gets dense.
- In-app clear-all cache/graph controls.
