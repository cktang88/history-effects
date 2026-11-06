import { create } from "zustand";
import type { Story } from "../types";
import * as atlas from "../atlas/api";
import { layoutTimeline, type Column, type Layout } from "./layout";
import { lineage, type CausalEdgeType, type EventNodeType } from "./model";

export type JobKind = "explore" | "effects" | "causes" | "more" | "enrich" | "path" | "explain";

// `anchors`: nodes the job builds on; if one disappears the job is aborted.
export type Job = { kind: JobKind; label: string; thinking: string; abort: AbortController; anchors: string[] };

export type Selection = { type: "node" | "edge" | "story"; id: string } | null;

export type Toast = { id: number; message: string; tone: "error" | "info" };

type Snapshot = { nodes: EventNodeType[]; edges: CausalEdgeType[]; stories: Story[] };

export type GraphState = Snapshot & {
  columns: Column[];
  selection: Selection;
  focus: { nodes: Set<string>; edges: Set<string> } | null;
  jobs: Record<string, Job>;
  toasts: Toast[];
  history: Snapshot[];
  details: Record<string, atlas.Detail>;
  // In/out edge counts per node, recomputed only when edges change, so cards
  // don't scan every edge on every store update.
  degree: Record<string, { in: number; out: number }>;
};

// Overview mode (zoomed out) shows cards with different content, so card
// heights are measured per mode.
type Heights = Record<string, { detail?: number; overview?: number }>;

const STORAGE_KEY = "history-effects:graph:v2";

function loadSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: [], edges: [], stories: [] };
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    return {
      nodes: (parsed.nodes ?? []).map((n) => ({ ...n, type: "event" as const })),
      edges: (parsed.edges ?? []).map((e) => ({ ...e, type: "causal" as const })),
      stories: parsed.stories ?? [],
    };
  } catch {
    return { nodes: [], edges: [], stories: [] };
  }
}

// Measured card heights per mode, kept outside the store so the layout can
// read them while the store itself is being created.
const measuredHeights: Heights = {};
let overviewMode = false;

export const cardHeight = (id: string) => measuredHeights[id]?.[overviewMode ? "overview" : "detail"];

export function computeLayout(nodes: EventNodeType[], edges: CausalEdgeType[]): Layout {
  return layoutTimeline(
    nodes.map((n) => ({ id: n.id, year: n.data.year, row: n.data.row, height: cardHeight(n.id) })),
    edges
  );
}

function degreesOf(edges: CausalEdgeType[]): GraphState["degree"] {
  const d: GraphState["degree"] = {};
  for (const e of edges) {
    (d[e.source] ??= { in: 0, out: 0 }).out++;
    (d[e.target] ??= { in: 0, out: 0 }).in++;
  }
  return d;
}

function withLayout(nodes: EventNodeType[], edges: CausalEdgeType[]) {
  const { positions, columns } = computeLayout(nodes, edges);
  return { nodes: nodes.map((n) => ({ ...n, position: positions.get(n.id)! })), columns };
}

const initial = loadSnapshot();

export const useGraph = create<GraphState>(() => ({
  ...initial,
  ...withLayout(initial.nodes, initial.edges),
  selection: null,
  focus: null,
  jobs: {},
  toasts: [],
  history: [],
  details: {},
  degree: degreesOf(initial.edges),
}));

export const graph = () => useGraph.getState();

// --- structural mutations ----------------------------------------------------

let layoutFrame = 0;
let tweenFrame = 0;
const TWEEN_MS = 480;

// Coalesces layout to the next frames. Two frames so a newly inserted node is
// painted at its spawn point first and then glides to its slot.
export function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      const { nodes, edges } = graph();
      const { positions, columns } = computeLayout(nodes, edges);
      useGraph.setState({ columns });
      tweenTo(positions);
    });
  });
}

// Positions are tweened in JS (not CSS) so edges, which React Flow derives
// from node positions, move in lockstep with the cards.
function tweenTo(targets: Map<string, { x: number; y: number }>) {
  cancelAnimationFrame(tweenFrame);
  const starts = new Map(graph().nodes.map((n) => [n.id, n.position]));
  const moving = [...targets].some(([id, t]) => {
    const s = starts.get(id);
    return !s || Math.abs(s.x - t.x) > 0.5 || Math.abs(s.y - t.y) > 0.5;
  });
  if (!moving) return;
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t0 = performance.now();
  const frame = (now: number) => {
    const p = reduced ? 1 : Math.min(1, (now - t0) / TWEEN_MS);
    const k = 1 - Math.pow(1 - p, 3);
    useGraph.setState((s) => ({
      nodes: s.nodes.map((n) => {
        const to = targets.get(n.id);
        const from = starts.get(n.id) ?? to;
        if (!to || !from) return n;
        return { ...n, position: { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k } };
      }),
    }));
    if (p < 1) tweenFrame = requestAnimationFrame(frame);
  };
  tweenFrame = requestAnimationFrame(frame);
}

// The single entry point for structural changes. It keeps invariants that
// concurrent async actions could otherwise break: no edge without both
// endpoints, no story pointing at missing nodes/edges, and no job running
// for a node that's gone.
export function setGraph(patch: Partial<Pick<GraphState, "nodes" | "edges" | "stories">>) {
  const cur = graph();
  const nodes = patch.nodes ?? cur.nodes;
  let edges = patch.edges ?? cur.edges;
  let stories = patch.stories ?? cur.stories;
  if (patch.nodes || patch.edges) {
    const ids = new Set(nodes.map((n) => n.id));
    const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (valid.length !== edges.length) edges = valid;
    const edgeIds = new Set(edges.map((e) => e.id));
    stories = stories
      .filter((st) => st.nodeIds.every((id) => ids.has(id)))
      .map((st) => (st.edgeIds.every((id) => edgeIds.has(id)) ? st : { ...st, edgeIds: st.edgeIds.filter((id) => edgeIds.has(id)) }));
    abortOrphanedJobs(ids);
  }
  const changedEdges = edges !== cur.edges;
  useGraph.setState({
    ...(patch.nodes ? { nodes } : {}),
    ...(changedEdges ? { edges, degree: degreesOf(edges) } : {}),
    ...(stories !== cur.stories ? { stories } : {}),
  });
  refreshFocus();
  scheduleLayout();
  schedulePersist();
}

function abortOrphanedJobs(nodeIds: Set<string>) {
  const { jobs } = graph();
  const orphaned = Object.entries(jobs).filter(([, j]) => j.anchors.some((a) => !nodeIds.has(a)));
  if (orphaned.length === 0) return;
  for (const [, j] of orphaned) j.abort.abort();
  const rest = { ...jobs };
  for (const [k] of orphaned) delete rest[k];
  useGraph.setState({ jobs: rest });
}

// Records a card's measured height for the current mode; relayouts only when
// a height actually changed.
export function recordHeights(measured: { id: string; height: number }[]) {
  const mode = overviewMode ? "overview" : "detail";
  let changed = false;
  for (const m of measured) {
    if (Math.abs((measuredHeights[m.id]?.[mode] ?? 0) - m.height) < 2) continue;
    measuredHeights[m.id] = { ...measuredHeights[m.id], [mode]: m.height };
    changed = true;
  }
  if (changed) scheduleLayout();
}

export function setOverview(overview: boolean) {
  if (overviewMode === overview) return;
  overviewMode = overview;
  scheduleLayout();
}

export function checkpoint() {
  const { nodes, edges, stories, history } = graph();
  useGraph.setState({ history: [...history.slice(-29), { nodes, edges, stories }] });
}

export function undo() {
  const { history } = graph();
  const last = history[history.length - 1];
  if (!last) return toast("Nothing to undo", "info");
  // In-flight actions were building on the state being undone.
  cancelAllJobs();
  useGraph.setState({ history: history.slice(0, -1), selection: null, focus: null });
  setGraph(last);
}

// --- selection & focus -------------------------------------------------------

export function select(selection: Selection) {
  useGraph.setState({ selection, focus: computeFocus(selection) });
  if (selection?.type === "node") loadDetail(selection.id);
}

// Curated entities carry a Wikipedia summary, sourced links and structure;
// fetch them when the entity is opened.
export function loadDetail(id: string) {
  const s = graph();
  if (s.details[id] || s.nodes.find((n) => n.id === id)?.data.source !== "db") return;
  atlas
    .detail(id)
    .then((d) => useGraph.setState((st) => ({ details: { ...st.details, [id]: d } })))
    .catch(() => {});
}

function computeFocus(selection: Selection): GraphState["focus"] {
  const { edges, stories } = graph();
  if (!selection) return null;
  if (selection.type === "node") return lineage(edges, selection.id);
  if (selection.type === "edge") {
    const e = edges.find((x) => x.id === selection.id);
    return e ? { nodes: new Set([e.source, e.target]), edges: new Set([e.id]) } : null;
  }
  const story = stories.find((s) => s.id === selection.id);
  return story ? { nodes: new Set(story.nodeIds), edges: new Set(story.edgeIds) } : null;
}

function refreshFocus() {
  const { selection, nodes, edges, stories } = graph();
  const exists =
    !selection ||
    (selection.type === "node" && nodes.some((n) => n.id === selection.id)) ||
    (selection.type === "edge" && edges.some((e) => e.id === selection.id)) ||
    (selection.type === "story" && stories.some((s) => s.id === selection.id));
  const next = exists ? selection : null;
  useGraph.setState({ selection: next, focus: computeFocus(next) });
}

// --- jobs ---------------------------------------------------------------------

export function startJob(key: string, kind: JobKind, label: string, anchors: string[] = []): AbortController | null {
  if (graph().jobs[key]) return null;
  const abort = new AbortController();
  useGraph.setState((s) => ({ jobs: { ...s.jobs, [key]: { kind, label, thinking: "", abort, anchors } } }));
  return abort;
}

// Ends a job, but only the caller's own: after a cancel, a newer job may
// already be running under the same key.
export function endJob(key: string, abort?: AbortController) {
  useGraph.setState((s) => {
    const job = s.jobs[key];
    if (!job || (abort && job.abort !== abort)) return {};
    const { [key]: _, ...rest } = s.jobs;
    return { jobs: rest };
  });
}

// Moves a running job to a new key (e.g. when a placeholder merges into an
// existing node), keeping its controller.
export function rekeyJob(from: string, to: string, anchors: string[]) {
  useGraph.setState((s) => {
    const job = s.jobs[from];
    if (!job || s.jobs[to]) return {};
    const { [from]: _, ...rest } = s.jobs;
    return { jobs: { ...rest, [to]: { ...job, anchors } } };
  });
}

// Reasoning arrives token by token; batch it so we re-render a few times a
// second instead of hundreds.
const thinkingBuffers = new Map<string, string>();
let thinkingTimer: ReturnType<typeof setTimeout> | null = null;

export function appendThinking(key: string, text: string) {
  thinkingBuffers.set(key, (thinkingBuffers.get(key) ?? "") + text);
  if (thinkingTimer) return;
  thinkingTimer = setTimeout(() => {
    thinkingTimer = null;
    useGraph.setState((s) => {
      const jobs = { ...s.jobs };
      for (const [k, t] of thinkingBuffers) {
        const job = jobs[k];
        if (job) jobs[k] = { ...job, thinking: (job.thinking + t).slice(-400) };
      }
      thinkingBuffers.clear();
      return { jobs };
    });
  }, 150);
}

export function cancelAllJobs() {
  for (const job of Object.values(graph().jobs)) job.abort.abort();
  useGraph.setState({ jobs: {} });
}

// --- toasts -------------------------------------------------------------------

let toastId = 0;

export function toast(message: string, tone: Toast["tone"] = "error") {
  const id = ++toastId;
  useGraph.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone }] }));
  setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 3000);
}

export function dismissToast(id: number) {
  useGraph.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

// --- persistence ----------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { nodes, edges, stories } = graph();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          nodes: nodes.map(({ id, data, position }) => ({ id, data, position })),
          edges: edges.map(({ id, source, target, data }) => ({ id, source, target, data })),
          stories,
        })
      );
    } catch {
      // Storage unavailable: the session still works, it just won't survive reload.
    }
  }, 400);
}
