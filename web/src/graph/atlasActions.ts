// Map-building from the curated database: deterministic, sourced, instant.
// The LLM paths in actions.ts remain as a labeled fallback.

import * as atlas from "../atlas/api";
import type { Era } from "../atlas/eras";
import type { CausalEdgeType, EventNodeType } from "./model";
import { maxRow, newId } from "./model";
import { ROW_H } from "./layout";
import { checkpoint, endJob, graph, select, setGraph, startJob, toast } from "./store";
import type { Domain, Story } from "../types";
import { fitTo, focusNode, freeRows, sortRowsByYear } from "./actions";

const PEOPLE = new Set(["leader", "thinker"]);

const KIND_DOMAIN: Record<string, Domain> = {
  war: "military",
  battle: "military",
  revolution: "political",
  treaty: "political",
  disaster: "demographic",
  atrocity: "social",
  event: "political",
  period: "cultural",
  state: "political",
  leader: "political",
  thinker: "cultural",
  invention: "technological",
};

export const KIND_LABEL: Record<string, string> = {
  war: "War",
  battle: "Battle",
  revolution: "Revolution",
  treaty: "Treaty",
  disaster: "Disaster",
  atrocity: "Atrocity",
  event: "Event",
  period: "Era",
  state: "State",
  leader: "Leader",
  thinker: "Thinker",
  invention: "Invention",
};

const fmt = (y: number) => (y < 0 ? `${-y} BCE` : `${y}`);

export function dateLabelOf(e: atlas.EntitySummary): string {
  if (PEOPLE.has(e.kind)) return e.end ? `${fmt(e.start)}–${fmt(e.end)}` : `b. ${fmt(e.start)}`;
  if (e.end && e.end !== e.start) return `${fmt(e.start)}–${e.end >= 0 && e.start >= 0 && Math.floor(e.end / 100) === Math.floor(e.start / 100) && e.end - e.start < 100 ? String(e.end).slice(-2) : fmt(e.end)}`;
  return fmt(e.start);
}

// Where an entity sits on the timeline. People sit at the height of their
// career rather than their birth.
export function anchorYear(e: atlas.EntitySummary): number {
  if (!PEOPLE.has(e.kind)) return e.start;
  return Math.min(e.start + 35, e.end ?? Infinity);
}

function nodeFor(e: atlas.EntitySummary, row: number, spawn?: { x: number; y: number }): EventNodeType {
  return {
    id: e.id,
    type: "event",
    position: spawn ?? { x: 0, y: row * ROW_H },
    data: {
      title: e.title,
      description: e.desc ? e.desc.charAt(0).toUpperCase() + e.desc.slice(1) : "",
      year: anchorYear(e),
      endYear: PEOPLE.has(e.kind) ? undefined : e.end,
      dateLabel: dateLabelOf(e),
      place: e.country ?? e.region,
      domain: KIND_DOMAIN[e.kind],
      row,
      source: "db",
      kind: e.kind,
      sig: e.sig,
      region: e.region,
      country: e.country,
    },
  };
}

const onMap = (id: string) => graph().nodes.some((n) => n.id === id);

function addEntity(e: atlas.EntitySummary, row: number, spawnFrom?: string): boolean {
  if (onMap(e.id)) return false;
  const spawn = spawnFrom ? graph().nodes.find((n) => n.id === spawnFrom)?.position : undefined;
  setGraph({ nodes: [...graph().nodes, nodeFor(e, row, spawn)] });
  return true;
}

function addLink(view: atlas.LinkView): string | null {
  const { edges } = graph();
  const existing = edges.find(
    (e) => (e.source === view.source && e.target === view.target) || (e.source === view.target && e.target === view.source)
  );
  if (existing?.data?.source === "db") return existing.id;
  const edge: CausalEdgeType = {
    id: view.id,
    type: "causal",
    source: view.source,
    target: view.target,
    data: { strength: view.strength, reasoning: view.reasoning, source: "db", evidence: view.evidence, reviewed: view.reviewed },
  };
  // A sourced link supersedes an AI guess between the same pair.
  setGraph({ edges: [...edges.filter((e) => e.id !== existing?.id), edge] });
  return edge.id;
}

// Draws every sourced link between entities that are already on the map, so
// separate threads visibly converge.
export async function linkAmong(ids: string[]) {
  const details = await Promise.all(ids.map((id) => atlas.detail(id).catch(() => null)));
  for (const d of details) {
    if (!d) continue;
    for (const l of [...d.causes, ...d.effects]) if (onMap(l.source) && onMap(l.target)) addLink(l);
  }
}

const isDbNode = (id: string) => graph().nodes.find((n) => n.id === id)?.data.source === "db";

// Adds up to `n` sourced neighbors not yet on the map; returns how many.
async function grow(id: string, direction: "effects" | "causes", n: number): Promise<string[]> {
  const d = await atlas.detail(id);
  const node = graph().nodes.find((x) => x.id === id);
  if (!node) return [];
  const links = direction === "effects" ? d.effects : d.causes;
  const other = (l: atlas.LinkView) => (direction === "effects" ? l.target : l.source);
  const byId = new Map(d.neighbors.map((e) => [e.id, e]));
  const siblings = links.map(other).filter(onMap);
  const fresh = links.filter((l) => !onMap(other(l))).slice(0, n);
  const rows = freeRows(node.data.row, fresh.length, graph().nodes.filter((x) => siblings.includes(x.id)).map((x) => x.data.row));
  const added: string[] = [];
  fresh.forEach((l, i) => {
    const e = byId.get(other(l));
    if (e && addEntity(e, rows[i] ?? node.data.row + i + 1, id)) added.push(e.id);
  });
  for (const l of links) if (onMap(l.source) && onMap(l.target)) addLink(l);
  sortRowsByYear(added);
  return added;
}

export async function openEntity(id: string, opts: { causes?: number; effects?: number } = {}) {
  if (onMap(id)) return focusNode(id);
  const abort = startJob(id, "explore", "Opening");
  if (!abort) return;
  try {
    const d = await atlas.detail(id);
    const { nodes } = graph();
    const row = nodes.length ? Math.round(maxRow(nodes)) + 4 : 0;
    addEntity(d.entity, row);
    select({ type: "node", id });
    const effects = await grow(id, "effects", opts.effects ?? 5);
    const causes = await grow(id, "causes", opts.causes ?? 3);
    await linkAmong([...effects, ...causes]);
    fitTo([id, ...effects, ...causes], 0.95);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    endJob(id);
  }
}

// Returns false when the database has nothing more in that direction, so the
// caller can fall back to the model.
export async function expandFromDb(id: string, direction: "effects" | "causes"): Promise<boolean> {
  if (!isDbNode(id)) return false;
  const abort = startJob(id, direction, direction === "effects" ? "Adding sourced effects" : "Adding sourced causes");
  if (!abort) return true;
  try {
    const added = await grow(id, direction, 5);
    await linkAmong(added);
    if (added.length === 0) return false;
    fitTo([id, ...added]);
    return true;
  } finally {
    endJob(id);
  }
}

// Resolves free text to a database entity when it's a confident match.
export async function resolveEntity(text: string): Promise<atlas.EntitySummary | null> {
  const results = await atlas.search(text, 5);
  const top = results[0];
  if (!top) return null;
  const words = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !["the", "and", "of", "war"].includes(w));
  const q = words(text);
  const t = new Set(words(top.title));
  return q.length > 0 && q.every((w) => t.has(w) || [...t].some((x) => x.startsWith(w))) ? top : null;
}

// Traces the strongest sourced chain between two entities. Returns false if
// the database has no path, so the caller can ask the model instead.
export async function connectFromDb(fromId: string, toId: string, opts: { skipDirect?: boolean } = {}): Promise<boolean> {
  const { links, reversed } = await atlas.path(fromId, toId, opts.skipDirect);
  if (links.length === 0) return false;
  checkpoint();
  const [a, b] = reversed ? [toId, fromId] : [fromId, toId];
  const ids = [links[0]!.source, ...links.map((l) => l.target)];
  const details = await Promise.all(ids.filter((id) => !onMap(id)).map((id) => atlas.detail(id)));
  const byId = new Map(details.map((d) => [d.entity.id, d.entity]));
  const { nodes } = graph();
  const baseRow = onMap(a) ? nodes.find((n) => n.id === a)!.data.row : nodes.length ? Math.round(maxRow(nodes)) + 3 : 0;
  let prev: string | undefined;
  for (const id of ids) {
    const e = byId.get(id);
    if (e) addEntity(e, baseRow, prev);
    prev = id;
  }
  const edgeIds = links.map((l) => addLink(l)).filter((x): x is string => !!x);
  const story: Story = {
    id: newId("s"),
    fromId: a,
    toId: b,
    nodeIds: ids,
    edgeIds,
    verdict: links.length <= 3 ? "strong" : "moderate",
    summary:
      (reversed ? "The second event came first, so this traces the chain in the order it happened. " : "") +
      `A chain of ${links.length} sourced link${links.length === 1 ? "" : "s"}, each backed by Wikipedia or Wikidata. Open any link to see its evidence.`,
  };
  setGraph({ stories: [...graph().stories, story] });
  select({ type: "story", id: story.id });
  fitTo(ids, 0.95);
  return true;
}

// Puts the most significant entities of an era × region × lens slice on the
// map, with every sourced link among them (and to what's already there).
export async function addSlice(era: Era, region: string, lens: string, limit = 12) {
  const key = `slice:${era.id}:${region}:${lens}`;
  const abort = startJob(key, "explore", `Adding ${era.label}${region !== "all" ? ` · ${region}` : ""}`);
  if (!abort) return;
  try {
    const { items } = await atlas.browse({ from: era.from, to: era.to, region, lens, limit });
    const { nodes } = graph();
    const band = nodes.length ? Math.round(maxRow(nodes)) + 3 : 0;
    const added = items.filter((e, i) => addEntity(e, band + (i % 4)));
    await linkAmong([...items.map((e) => e.id), ...graph().nodes.filter((n) => n.data.source === "db").map((n) => n.id)].filter(onMap));
    if (added.length === 0 && items[0]) focusNode(items[0].id);
    else fitTo(items.map((e) => e.id), 0.9);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    endJob(key);
  }
}

// Adds one sourced neighbor next to an entity already on the map.
export async function addNeighbor(anchorId: string, link: atlas.LinkView, entity: atlas.EntitySummary) {
  const anchor = graph().nodes.find((n) => n.id === anchorId);
  if (!anchor) return openEntity(entity.id);
  if (!onMap(entity.id)) {
    const isEffect = link.source === anchorId;
    const siblings = graph()
      .edges.filter((e) => (isEffect ? e.source === anchorId : e.target === anchorId))
      .map((e) => (isEffect ? e.target : e.source));
    const taken = graph().nodes.filter((n) => siblings.includes(n.id)).map((n) => n.data.row);
    addEntity(entity, freeRows(anchor.data.row, 1, taken)[0] ?? anchor.data.row + 1, anchorId);
  }
  addLink(link);
  await linkAmong([entity.id]);
  select({ type: "edge", id: link.id });
  fitTo([anchorId, entity.id]);
}
