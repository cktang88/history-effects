import type { ReactFlowInstance } from "@xyflow/react";
import * as api from "../api";
import { connectFromDb, expandFromDb, openEntity, resolveEntity } from "./atlasActions";
import type { CausalEdgeData, CausalItem, HistoricalEvent, Story } from "../types";
import { MIN_ZOOM, NODE_H, NODE_W, ROW_H } from "./layout";
import {
  ancestry,
  eventOf,
  findEdgeBetween,
  incoming,
  maxRow,
  newId,
  outgoing,
  titleKey,
  type CausalEdgeType,
  type EventNodeType,
} from "./model";
import {
  appendThinking,
  cancelAllJobs,
  cardHeight,
  checkpoint,
  computeLayout,
  endJob,
  graph,
  rekeyJob,
  select,
  setGraph,
  startJob,
  toast,
  useGraph,
} from "./store";

// --- camera ---------------------------------------------------------------------

let flow: ReactFlowInstance<EventNodeType, CausalEdgeType> | null = null;

export function setFlow(instance: typeof flow) {
  flow = instance;
}

const INSPECTOR_W = 424;
const TOP = 96;
const BOTTOM = 70;

// Frames a set of nodes using their layout *targets* (not their in-flight
// tweened positions), leaving room for the top bar and the inspector.
function frame(ids: string[], opts: { maxZoom?: number; minZoom?: number; keepZoom?: boolean } = {}) {
  const el = document.querySelector(".react-flow");
  if (!flow || !el) return;
  const { nodes, edges, selection } = graph();
  const { positions } = computeLayout(nodes, edges);
  const boxes = ids
    .map((id) => {
      const p = positions.get(id);
            const h = cardHeight(id) ?? NODE_H;
            return p && { x1: p.x, y1: p.y, x2: p.x + NODE_W, y2: p.y + h };
    })
    .filter((b): b is { x1: number; y1: number; x2: number; y2: number } => !!b);
  if (boxes.length === 0) return;
  const b = {
    x1: Math.min(...boxes.map((v) => v.x1)),
    y1: Math.min(...boxes.map((v) => v.y1)),
    x2: Math.max(...boxes.map((v) => v.x2)),
    y2: Math.max(...boxes.map((v) => v.y2)),
  };
  const rect = el.getBoundingClientRect();
  const wide = rect.width > 720;
  const right = selection && wide ? INSPECTOR_W : 0;
  const availW = Math.max(200, rect.width - right - 80);
  const availH = Math.max(200, rect.height - TOP - BOTTOM);
  const zoom = opts.keepZoom
    ? Math.max(flow.getZoom(), opts.minZoom ?? 0.85)
    : Math.min(opts.maxZoom ?? 1, Math.max(opts.minZoom ?? MIN_ZOOM, Math.min(availW / (b.x2 - b.x1), availH / (b.y2 - b.y1))));
  const cx = (b.x1 + b.x2) / 2;
  const cy = (b.y1 + b.y2) / 2;
  void flow.setViewport(
    { x: 40 + availW / 2 - cx * zoom, y: TOP + availH / 2 - cy * zoom, zoom },
    { duration: 650 }
  );
}

export function fitTo(ids: string[], maxZoom = 1) {
  frame(ids, { maxZoom });
}

export function fitAll() {
  frame(graph().nodes.map((n) => n.id), { maxZoom: 1, minZoom: MIN_ZOOM });
}

export function centerOn(id: string) {
  frame([id], { keepZoom: true });
}

export function focusEdge(id: string) {
  const edge = graph().edges.find((e) => e.id === id);
  if (!edge) return;
  select({ type: "edge", id });
  frame([edge.source, edge.target], { maxZoom: 1 });
}

export function focusStory(id: string) {
  const story = graph().stories.find((s) => s.id === id);
  if (!story) return;
  select({ type: "story", id });
  frame(story.nodeIds, { maxZoom: 0.95 });
}

export function focusNode(id: string) {
  select({ type: "node", id });
  centerOn(id);
}

// --- graph building blocks ------------------------------------------------------

const findNode = (id: string) => graph().nodes.find((n) => n.id === id);
const findByTitle = (title: string, nodes = graph().nodes) => nodes.find((n) => titleKey(n.data.title) === titleKey(title));

function fillMissing(node: EventNodeType, event: HistoricalEvent): EventNodeType {
  const data = { ...node.data };
  for (const [k, v] of Object.entries(event) as [keyof HistoricalEvent, unknown][]) {
    if (v !== undefined && (data[k] === undefined || data[k] === "")) (data as Record<string, unknown>)[k] = v;
  }
  return { ...node, data };
}

// Adds an event, or merges it into an existing node with the same identity so
// separate lines of exploration converge on shared events.
function upsertEvent(event: HistoricalEvent, row: number, spawnFrom?: string): { id: string; created: boolean } {
  const { nodes } = graph();
  const existing = findByTitle(event.title, nodes);
  if (existing) {
    setGraph({ nodes: nodes.map((n) => (n.id === existing.id ? fillMissing(n, event) : n)) });
    return { id: existing.id, created: false };
  }
  const spawn = spawnFrom ? nodes.find((n) => n.id === spawnFrom)?.position : undefined;
  const node: EventNodeType = {
    id: newId("n"),
    type: "event",
    position: spawn ?? { x: 0, y: row * ROW_H },
    data: { ...event, row, source: "ai" },
  };
  setGraph({ nodes: [...nodes, node] });
  return { id: node.id, created: true };
}

function link(source: string, target: string, data: CausalEdgeData): string | null {
  if (source === target || !findNode(source) || !findNode(target)) return null;
  const { edges } = graph();
  const existing = findEdgeBetween(edges, source, target);
  if (existing) return existing.id;
  const edge: CausalEdgeType = { id: newId("e"), type: "causal", source, target, data: { source: "ai", ...data } };
  setGraph({ edges: [...edges, edge] });
  return edge.id;
}

function patchNode(id: string, patch: Partial<EventNodeType["data"]>) {
  setGraph({ nodes: graph().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) });
}

function addLinked(anchorId: string, item: CausalItem, direction: "effects" | "causes", row: number) {
  const { strength, reasoning, ...event } = item;
  const { id, created } = upsertEvent(event, row, anchorId);
  if (id === anchorId) return null;
  const [source, target] = direction === "effects" ? [anchorId, id] : [id, anchorId];
  link(source, target, { strength, reasoning });
  return { id, created };
}

// New neighbors were placed in arrival (importance) order; once all are in,
// reassign the same rows in year order so their edges fan without crossing.
export function sortRowsByYear(ids: string[]) {
  const { nodes } = graph();
  const group = ids.map((id) => nodes.find((n) => n.id === id)).filter((n): n is EventNodeType => !!n);
  if (group.length < 2) return;
  const rows = group.map((n) => n.data.row).sort((a, b) => a - b);
  const byYear = [...group].sort((a, b) => (a.data.year ?? 0) - (b.data.year ?? 0));
  const rowOf = new Map(byYear.map((n, i) => [n.id, rows[i]!]));
  setGraph({ nodes: nodes.map((n) => (rowOf.has(n.id) ? { ...n, data: { ...n.data, row: rowOf.get(n.id)! } } : n)) });
}

// Free rows nearest to a center, skipping rows already used by siblings.
export function freeRows(center: number, count: number, taken: number[]): number[] {
  const rows: number[] = [];
  for (let k = 0; rows.length < count && k < 50; k++) {
    for (const r of k === 0 ? [center] : [center - k, center + k]) {
      if (rows.length < count && !taken.some((t) => Math.abs(t - r) < 0.75)) rows.push(r);
    }
  }
  return rows.sort((a, b) => a - b);
}

function existingTitles(exceptId: string): string[] {
  return graph()
    .nodes.filter((n) => n.id !== exceptId)
    .map((n) => n.data.title)
    .slice(-50);
}

function reportError(e: unknown, abort: AbortController) {
  if (abort.signal.aborted) return;
  toast(e instanceof Error ? e.message : String(e));
}

const thinking = (key: string) => (text: string) => appendThinking(key, text);

// --- explore --------------------------------------------------------------------

export async function explore(text: string) {
  const phrase = text.trim();
  if (!phrase) return;
  const match = findByTitle(phrase);
  if (match) return focusNode(match.id);
  const entity = await resolveEntity(phrase).catch(() => null);
  if (entity) return openEntity(entity.id);

  checkpoint();
  const { nodes } = graph();
  const row = nodes.length ? Math.round(maxRow(nodes)) + 4 : 0;
  const placeholder = upsertEvent({ title: phrase.charAt(0).toUpperCase() + phrase.slice(1), description: "" }, row);
  let rootId = placeholder.id;
  const abort = startJob(rootId, "explore", `Exploring “${phrase}”`, [rootId]);
  if (!abort) return;
  select({ type: "node", id: rootId });
  centerOn(rootId);

  const created: Record<"effects" | "causes", string[]> = { effects: [], causes: [] };
  let first = true;
  try {
    await api.explore(phrase, {
      signal: abort.signal,
      onThinking: thinking(placeholder.id),
      onItem: (key, value, index) => {
        if (key === "event") {
          // May merge into an existing node, which then owns the job.
          rootId = settleRoot(placeholder.id, value as HistoricalEvent);
          return;
        }
        if (key !== "effects" && key !== "causes") return;
        const root = findNode(rootId);
        if (!root) return;
        const rows = key === "effects" ? freeRows(root.data.row, 5, []) : freeRows(root.data.row, 3, []);
        const res = addLinked(rootId, value as CausalItem, key, rows[index] ?? root.data.row + index);
        if (res?.created) created[key].push(res.id);
        if (first) {
          first = false;
          fitTo([rootId, ...created.effects], 0.95);
        }
      },
    });
    sortRowsByYear(created.effects);
    sortRowsByYear(created.causes);
    select({ type: "node", id: rootId });
    fitTo([rootId, ...created.effects, ...created.causes], 0.95);
  } catch (e) {
    reportError(e, abort);
    const node = findNode(placeholder.id);
    if (node && !node.data.description) removeNodes([placeholder.id], false);
  } finally {
    endJob(placeholder.id, abort);
    endJob(rootId, abort);
  }
}

function settleRoot(placeholderId: string, event: HistoricalEvent): string {
  const { nodes, edges } = graph();
  const twin = nodes.find((n) => n.id !== placeholderId && titleKey(n.data.title) === titleKey(event.title));
  if (!twin) {
    patchNode(placeholderId, event);
    return placeholderId;
  }
  // The phrase resolved to an event already on the map: grow from that one.
  // Re-key the job first so removing the placeholder doesn't abort it.
  rekeyJob(placeholderId, twin.id, [twin.id]);
  setGraph({ nodes: nodes.filter((n) => n.id !== placeholderId), edges });
  select({ type: "node", id: twin.id });
  return twin.id;
}

// --- expand ---------------------------------------------------------------------

export async function expand(nodeId: string, direction: "effects" | "causes") {
  if (graph().jobs[nodeId]) return;
  if (await expandFromDb(nodeId, direction).catch(() => false)) return;
  if (findNode(nodeId)?.data.source === "db") {
    toast(`No more sourced ${direction} recorded — asking the AI (results will be marked AI).`, "info");
  }
  const { nodes, edges } = graph();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const neighborIds =
    direction === "effects" ? outgoing(edges, nodeId).map((e) => e.target) : incoming(edges, nodeId).map((e) => e.source);
  const neighbors = nodes.filter((n) => neighborIds.includes(n.id));
  const more = neighbors.length > 0;
  const n = more ? 3 : direction === "effects" ? 5 : 4;
  const verb = direction === "effects" ? (more ? "Finding more effects of" : "Tracing effects of") : more ? "Finding more causes of" : "Tracing causes of";
  const abort = startJob(nodeId, more ? "more" : direction, `${verb} ${node.data.title}`, [nodeId]);
  if (!abort) return;
  checkpoint();

  const rows = freeRows(node.data.row, n, neighbors.map((x) => x.data.row));
  const created: string[] = [];
  const touched: string[] = [];
  try {
    await api.expand(
      direction,
      eventOf(node),
      n,
      {
        path: ancestry(nodes, edges, nodeId),
        existing: existingTitles(nodeId).filter((t) => !neighbors.some((x) => x.data.title === t)),
        exclude: neighbors.map((x) => x.data.title),
      },
      {
        signal: abort.signal,
        onThinking: thinking(nodeId),
        onItem: (key, value, index) => {
          if (key !== direction) return;
          const res = addLinked(nodeId, value as CausalItem, direction, rows[index] ?? node.data.row + index + 1);
          if (!res) return;
          touched.push(res.id);
          if (res.created) created.push(res.id);
          if (touched.length === 1) fitTo([nodeId, ...neighborIds, res.id]);
        },
      }
    );
    sortRowsByYear(created);
    if (touched.length === 0) toast("No new connections found.", "info");
    fitTo([nodeId, ...neighborIds, ...touched]);
  } catch (e) {
    reportError(e, abort);
  } finally {
    endJob(nodeId, abort);
  }
}

// --- trace a path between two events ---------------------------------------------

export type Endpoint = { nodeId: string } | { text: string };

const endpointLabel = (p: Endpoint) => ("nodeId" in p ? findNode(p.nodeId)?.data.title ?? "?" : p.text);
const endpointQuery = (p: Endpoint): HistoricalEvent | string => {
  if ("text" in p) return p.text;
  const node = findNode(p.nodeId);
  return node ? eventOf(node) : "";
};

export function resolveEndpoint(text: string): Endpoint {
  const match = findByTitle(text);
  return match ? { nodeId: match.id } : { text: text.trim() };
}

async function toEntityId(p: Endpoint): Promise<string | null> {
  if ("nodeId" in p) return findNode(p.nodeId)?.data.source === "db" ? p.nodeId : null;
  return (await resolveEntity(p.text).catch(() => null))?.id ?? null;
}

export async function connect(from: Endpoint, to: Endpoint, opts: { replaceDirect?: boolean } = {}) {
  const [a, b] = await Promise.all([toEntityId(from), toEntityId(to)]);
  if (a && b && (await connectFromDb(a, b, { skipDirect: opts.replaceDirect }).catch(() => false))) return;
  const storyId = newId("s");
  let fromId = "nodeId" in from ? from.nodeId : undefined;
  let toId = "nodeId" in to ? to.nodeId : undefined;
  // An endpoint node may have been removed while we were resolving.
  if ((fromId && !findNode(fromId)) || (toId && !findNode(toId))) return;
  const anchors = [fromId, toId].filter((x): x is string => !!x);
  const abort = startJob(storyId, "path", `Connecting ${endpointLabel(from)} → ${endpointLabel(to)}`, anchors);
  if (!abort) return;
  checkpoint();

  const { nodes } = graph();
  const anchorNode = (fromId && findNode(fromId)) || (toId && findNode(toId));
  const fromRow = anchorNode ? anchorNode.data.row : nodes.length ? Math.round(maxRow(nodes)) + 3 : 0;
  const stepIds: string[] = [];
  const edgeIds: string[] = [];
  let prev: string | undefined = fromId;

  const ensureFrom = (event?: HistoricalEvent) => {
    if (fromId) return fromId;
    fromId = upsertEvent(event ?? { title: endpointLabel(from), description: "" }, fromRow).id;
    prev = fromId;
    return fromId;
  };

  try {
    const result = await api.tracePath(endpointQuery(from), endpointQuery(to), {
      signal: abort.signal,
      onThinking: thinking(storyId),
      onItem: (key, value) => {
        if (key === "from") ensureFrom(value as HistoricalEvent);
        else if (key === "to" && !toId) toId = upsertEvent(value as HistoricalEvent, fromRow, ensureFrom()).id;
        else if (key === "steps") {
          const { strength, reasoning, ...event } = value as CausalItem;
          const start = ensureFrom();
          if (toId && findByTitle(event.title)?.id === toId) return;
          const { id } = upsertEvent(event, fromRow, prev ?? start);
          if (id === start || stepIds.includes(id)) return;
          const edgeId = link(prev ?? start, id, { strength, reasoning });
          if (edgeId) edgeIds.push(edgeId);
          stepIds.push(id);
          prev = id;
          if (stepIds.length === 1) fitTo([start, id]);
        }
      },
    });
    const start = ensureFrom(result.from);
    toId ??= upsertEvent(result.to, fromRow, start).id;
    finishStory({ storyId, fromId: start, toId, stepIds, edgeIds, result, last: prev ?? start, replaceDirect: !!opts.replaceDirect });
  } catch (e) {
    reportError(e, abort);
  } finally {
    endJob(storyId, abort);
  }
}

function finishStory(p: {
  storyId: string;
  fromId: string;
  toId: string;
  stepIds: string[];
  edgeIds: string[];
  result: Awaited<ReturnType<typeof api.tracePath>>;
  last: string;
  replaceDirect: boolean;
}) {
  const { result } = p;
  const edgeIds = [...p.edgeIds];
  if (result.verdict !== "none" || p.stepIds.length > 0) {
    const finalId = link(p.last, p.toId, result.final);
    if (finalId) edgeIds.push(finalId);
  }
  if (p.replaceDirect && p.stepIds.length > 0) {
    const direct = graph().edges.find((e) => e.source === p.fromId && e.target === p.toId);
    if (direct) setGraph({ edges: graph().edges.filter((e) => e.id !== direct.id) });
  }
  spreadChainRows(p.fromId, p.toId, p.stepIds);
  const story: Story = {
    id: p.storyId,
    fromId: p.fromId,
    toId: p.toId,
    nodeIds: [p.fromId, ...p.stepIds, p.toId],
    edgeIds,
    verdict: result.verdict,
    summary: result.summary,
  };
  setGraph({ stories: [...graph().stories.filter((s) => s.id !== story.id), story] });
  select({ type: "story", id: story.id });
  fitTo(story.nodeIds, 0.95);
  if (result.verdict === "none") toast("No meaningful causal connection found — see the explanation.", "info");
}

// Steps created for a chain sit on a line between its endpoints' rows.
function spreadChainRows(fromId: string, toId: string, stepIds: string[]) {
  const from = findNode(fromId);
  const to = findNode(toId);
  if (!from || !to) return;
  const k = stepIds.length + 1;
  const rowOf = new Map(stepIds.map((id, i) => [id, from.data.row + ((to.data.row - from.data.row) * (i + 1)) / k]));
  setGraph({
    nodes: graph().nodes.map((n) => (rowOf.has(n.id) && n.data.row === from.data.row ? { ...n, data: { ...n.data, row: rowOf.get(n.id)! } } : n)),
  });
}

export function findStepsBetween(edgeId: string) {
  const edge = graph().edges.find((e) => e.id === edgeId);
  if (!edge) return;
  void connect({ nodeId: edge.source }, { nodeId: edge.target }, { replaceDirect: true });
}

// --- explain / verify -------------------------------------------------------------

export async function explainEdge(edgeId: string) {
  const { edges } = graph();
  const edge = edges.find((e) => e.id === edgeId);
  const cause = edge && findNode(edge.source);
  const effect = edge && findNode(edge.target);
  if (!edge || !cause || !effect) return;
  const abort = startJob(edgeId, "explain", `Explaining ${cause.data.title} → ${effect.data.title}`, [cause.id, effect.id]);
  if (!abort) return;
  try {
    const explanation = await api.explain(eventOf(cause), eventOf(effect), edge.data?.reasoning ?? "", {
      signal: abort.signal,
      onThinking: thinking(edgeId),
    });
    setGraph({
      edges: graph().edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data!, explanation } } : e)),
    });
  } catch (e) {
    reportError(e, abort);
  } finally {
    endJob(edgeId, abort);
  }
}

export async function verify(nodeId: string) {
  const node = findNode(nodeId);
  if (!node) return;
  const abort = startJob(nodeId, "enrich", `Checking sources for ${node.data.title}`, [nodeId]);
  if (!abort) return;
  try {
    const { event } = await api.enrich(eventOf(node), { signal: abort.signal, onThinking: thinking(nodeId) });
    if (!abort.signal.aborted) patchNode(nodeId, { ...event, title: node.data.title, verified: true });
  } catch (e) {
    reportError(e, abort);
  } finally {
    endJob(nodeId, abort);
  }
}

// --- removal --------------------------------------------------------------------

export function removeNodes(ids: string[], undoable = true) {
  if (undoable) checkpoint();
  for (const id of ids) graph().jobs[id]?.abort.abort();
  const { nodes, edges, stories } = graph();
  const gone = new Set(ids);
  setGraph({
    nodes: nodes.filter((n) => !gone.has(n.id)),
    edges: edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    stories: stories.filter((s) => !s.nodeIds.some((id) => gone.has(id))),
  });
}

export function removeEdge(edgeId: string) {
  checkpoint();
  const { edges, stories } = graph();
  setGraph({
    edges: edges.filter((e) => e.id !== edgeId),
    stories: stories.filter((s) => !s.edgeIds.includes(edgeId)),
  });
}

export function clearAll() {
  checkpoint();
  cancelAllJobs();
  select(null);
  setGraph({ nodes: [], edges: [], stories: [] });
}

// --- keyboard navigation ---------------------------------------------------------

export function navigate(dir: "left" | "right" | "up" | "down") {
  const { selection, nodes, edges } = useGraph.getState();
  if (!selection || selection.type !== "node") {
    const first = nodes[0];
    if (first) focusNode(first.id);
    return;
  }
  const cur = nodes.find((n) => n.id === selection.id);
  if (!cur) return;
  const linked =
    dir === "right" ? outgoing(edges, cur.id).map((e) => e.target) : dir === "left" ? incoming(edges, cur.id).map((e) => e.source) : [];
  const pool = linked.length ? nodes.filter((n) => linked.includes(n.id)) : nodes.filter((n) => isToward(cur, n, dir));
  const best = pool.sort((a, b) => distance(cur, a, dir) - distance(cur, b, dir))[0];
  if (best) focusNode(best.id);
}

function isToward(from: EventNodeType, n: EventNodeType, dir: "left" | "right" | "up" | "down") {
  const dx = n.position.x - from.position.x;
  const dy = n.position.y - from.position.y;
  if (dir === "right") return dx > 1;
  if (dir === "left") return dx < -1;
  if (dir === "down") return dy > 1 && Math.abs(dx) < Math.abs(dy) * 3;
  return dy < -1 && Math.abs(dx) < Math.abs(dy) * 3;
}

function distance(from: EventNodeType, n: EventNodeType, dir: "left" | "right" | "up" | "down") {
  const dx = Math.abs(n.position.x - from.position.x);
  const dy = Math.abs(n.position.y - from.position.y);
  return dir === "left" || dir === "right" ? dy * 2 + dx : dx * 2 + dy;
}
