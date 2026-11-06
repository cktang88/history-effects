import { create } from "zustand";
import type { Story } from "../types";
import { layoutTimeline, type Column } from "./layout";
import { lineage, type CausalEdgeType, type EventNodeType } from "./model";

export type JobKind = "explore" | "effects" | "causes" | "more" | "enrich" | "path" | "explain";

export type Job = { kind: JobKind; label: string; thinking: string; abort: AbortController };

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
};

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

export function computeLayout(nodes: EventNodeType[], edges: CausalEdgeType[]) {
  return layoutTimeline(
    nodes.map((n) => ({ id: n.id, year: n.data.year, row: n.data.row, height: n.measured?.height })),
    edges
  );
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

export function setGraph(patch: Partial<Pick<GraphState, "nodes" | "edges" | "stories">>) {
  useGraph.setState(patch);
  refreshFocus();
  scheduleLayout();
  schedulePersist();
}

export function checkpoint() {
  const { nodes, edges, stories, history } = graph();
  useGraph.setState({ history: [...history.slice(-29), { nodes, edges, stories }] });
}

export function undo() {
  const { history } = graph();
  const last = history[history.length - 1];
  if (!last) return toast("Nothing to undo", "info");
  useGraph.setState({ history: history.slice(0, -1), selection: null, focus: null });
  setGraph(last);
}

// --- selection & focus -------------------------------------------------------

export function select(selection: Selection) {
  useGraph.setState({ selection, focus: computeFocus(selection) });
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

export function startJob(key: string, kind: JobKind, label: string): AbortController | null {
  if (graph().jobs[key]) return null;
  const abort = new AbortController();
  useGraph.setState((s) => ({ jobs: { ...s.jobs, [key]: { kind, label, thinking: "", abort } } }));
  return abort;
}

export function endJob(key: string) {
  useGraph.setState((s) => {
    const { [key]: _, ...rest } = s.jobs;
    return { jobs: rest };
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
