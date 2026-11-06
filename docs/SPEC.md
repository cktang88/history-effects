# History Effects — Spec

## Goal

Help a learner understand how history connects: what an event set in motion, what set it in motion, and how two distant events are linked. Every causal claim is weighted and shows where it came from.

## Architecture: database first, LLM second

LLM-only generation proved unstructured and prone to "stretching the point", like the books arguing salt drove all of history. The app now explores a **curated database** (see [`pipeline/README.md`](../pipeline/README.md)):

- **Entities** (~6k) from Wikidata, per lens (wars, battles, revolutions, treaties and institutions, disasters, atrocities, pivotal events, eras and movements, states, leaders, thinkers, inventions, ideas). They're ranked by sitelinks (how many Wikipedias cover them) so only high-order items make it in, then expanded with topics Wikipedia's own Background/Aftermath sections cite most.
- **Causal links** from Wikidata causal properties and from links inside Wikipedia's Background/Causes and Aftermath/Legacy sections, with the sentence as evidence. They're scored by corroboration and significance, then reviewed by Haiku agents (keep / reject / reverse, plus strength and mechanism). Unreviewed links appear only if two sources corroborate them.
- **Gap-fill links** chosen by agents from vetted shortlists for thin entities, labeled as curated by AI review.
- **Structure** (part of, participants, succession) for context.

The LLM (OpenRouter) remains for: in-depth explanations of a link, and growing the map beyond the database. Those results are marked **AI** in the UI.

The views below (timeline map, Connect, Explain) work over both kinds of data.

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

type EventNodeData = Event & {
  row: number;
  verified?: boolean;
  source?: "db" | "ai"; // db nodes use their Wikidata QID as node id
  kind?: string; sig?: number; region?: string; country?: string;
};

type CausalEdgeData = {
  strength: "primary" | "contributing" | "minor";
  reasoning?: string;        // the mechanism
  explanation?: Explanation; // filled by /api/explain
  source?: "db" | "ai";
  evidence?: ({ src: "wikipedia"; article; section; text } | { src: "wikidata"; prop } | { src: "curated" })[];
  reviewed?: boolean;
};

type Story = { id; fromId; toId; nodeIds; edgeIds; verdict?; summary? };
```

### Strength definitions (same wording used in prompts)

- **primary**: Direct, near-necessary cause. Without the source event, the consequence likely doesn't occur, or occurs much later / differently.
- **contributing**: One of several meaningful factors.
- **minor**: Peripheral, distal, or debated.

Visual encoding: line weight (primary thickest, minor dashed) plus a 3-bar strength meter in the inspector. Color is reserved for domain (card accent) and focus (lineage highlight).

## Layout

- ELK layered layout, left to right, computed in a Web Worker (`web/src/graph/elkLayout.ts`).
- x: time. Year columns (nearby years clustered; causal order decides sub-columns) are ELK partitions, and the ruler labels each column and the gaps between them.
- y: ELK orders and places cards. Current positions seed the ordering so the map stays stable; the remembered `row` seeds new cards near their anchor.
- Edges: ELK routes them orthogonally around cards (one port per edge end), and they are drawn as smooth left-to-right flow curves: each vertical jog becomes an S-curve, so crossings meet at an angle instead of forming ambiguous T/+ junctions. Each edge has a background-colored casing that cuts a small gap where a later edge crosses it. Long edges get a mid-edge direction chevron. Spacing leaves room for the expand badges that protrude below each card.
- Direction on demand: pointing at a card colors its links (blue = what led to it, orange = what it led to) and fades the rest; pointing at a link outlines its cause and effect cards. Selecting a card colors its whole upstream lineage blue and its downstream lineage orange.
- Cards are content-sized and measured per mode (detail ≥0.9× zoom: full text; overview: date and large title). Zoom never goes below 0.45×.
- Positions tween over ~480 ms. Routes deform with their moving endpoints and settle exactly on ELK's route. If ELK fails, a simple column layout with right-angle edges is used.

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
