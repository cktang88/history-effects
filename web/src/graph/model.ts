import type { Node, Edge } from "@xyflow/react";
import type { CausalEdgeData, EventNodeData, HistoricalEvent, Strength } from "../types";

export type EventNodeType = Node<EventNodeData, "event">;
export type CausalEdgeType = Edge<CausalEdgeData, "causal">;

export const newId = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

// Collapses trivial title variations so the same event from two different
// expansions becomes one node ("The Protestant Reformation (1517)" ≈ "Protestant Reformation").
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[''`’]s\b/g, "s")
    .replace(/[^a-z0-9À-ɏ]+/g, " ")
    .replace(/^\s*(the|a|an)\s+/, "")
    .trim();
}

export const eventOf = (n: EventNodeType): HistoricalEvent => {
  const { row: _row, verified: _verified, ...event } = n.data;
  return event;
};

const STRENGTH_RANK: Record<Strength, number> = { primary: 3, contributing: 2, minor: 1 };

export function strongerOf(a: Strength, b: Strength): Strength {
  return STRENGTH_RANK[a] >= STRENGTH_RANK[b] ? a : b;
}

export function findEdgeBetween(edges: CausalEdgeType[], a: string, b: string) {
  return edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
}

export const incoming = (edges: CausalEdgeType[], id: string) => edges.filter((e) => e.target === id);
export const outgoing = (edges: CausalEdgeType[], id: string) => edges.filter((e) => e.source === id);

function walk(start: string, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const n of next(id)) {
      if (seen.has(n) || n === start) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

// Everything upstream and downstream of a node, used to light up its lineage.
export function lineage(edges: CausalEdgeType[], id: string) {
  const ancestors = walk(id, (n) => incoming(edges, n).map((e) => e.source));
  const descendants = walk(id, (n) => outgoing(edges, n).map((e) => e.target));
  const nodes = new Set([id, ...ancestors, ...descendants]);
  const edgeIds = new Set(
    edges
      .filter(
        (e) =>
          (e.target === id || descendants.has(e.target)) && (e.source === id || descendants.has(e.source)) ||
          (e.source === id || ancestors.has(e.source)) && (e.target === id || ancestors.has(e.target))
      )
      .map((e) => e.id)
  );
  return { nodes, edges: edgeIds };
}

// The chain of titles that led to this node, following the strongest cause at
// each step. Gives the model the context the learner is exploring in.
export function ancestry(nodes: EventNodeType[], edges: CausalEdgeType[], id: string, max = 6): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  const seen = new Set([id]);
  let current = id;
  while (chain.length < max) {
    const parents = incoming(edges, current).filter((e) => !seen.has(e.source));
    if (parents.length === 0) break;
    const best = parents.reduce((a, b) => (STRENGTH_RANK[b.data?.strength ?? "minor"] > STRENGTH_RANK[a.data?.strength ?? "minor"] ? b : a));
    const parent = byId.get(best.source);
    if (!parent) break;
    chain.unshift(parent.data.title);
    seen.add(parent.id);
    current = parent.id;
  }
  return chain;
}

export function maxRow(nodes: EventNodeType[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.data.row), -Infinity);
}

export function yearsBetween(a?: number, b?: number): string | null {
  if (a === undefined || b === undefined) return null;
  const d = b - a;
  if (d === 0) return "same year";
  const abs = Math.abs(d);
  const unit = abs === 1 ? "year" : "years";
  return d > 0 ? `${abs} ${unit} later` : `${abs} ${unit} earlier`;
}

// Recognizes "How did X lead to Y?" or "X -> Y" typed into the explore box.
export function parseConnection(text: string): [string, string] | null {
  const arrow = text.split(/\s*(?:->|→|=>)\s*/);
  if (arrow.length === 2 && arrow[0] && arrow[1]) return [arrow[0].trim(), arrow[1].trim()];
  const m = text.match(/^\s*(?:how|why) (?:did|does|was) (.+?) (?:lead to|led to|cause|caused|shape|influence|affect|contribute to|result in|connected to|connect to)\s+(.+?)\??\s*$/i);
  return m ? [m[1]!.replace(/^the\s+/i, "the ").trim(), m[2]!.trim()] : null;
}
