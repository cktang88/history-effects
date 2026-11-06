// Graph layout with ELK (Eclipse Layout Kernel): layered, left-to-right,
// orthogonal edge routing around cards, crossing minimization, and edges
// spread along card sides. Year columns become ELK partitions so the map
// stays a timeline; each card's remembered row seeds the vertical order so
// the map stays recognizable as it grows.

import type { ELK as ElkApi, ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import { assignColumns, NODE_H, NODE_W, ROW_H, type Column, type LayoutEdge, type LayoutNode } from "./layout";

import type { Point } from "./routes";
export type { Point };
export type RoutedLayout = {
  positions: Map<string, Point>;
  columns: Column[];
  // Edge id → polyline from source side to target side (absolute coordinates).
  routes: Map<string, Point[]>;
};

// In the browser ELK runs in a Web Worker (see elkWorker.ts), so layouts
// never block the main thread; tests inject the bundled in-process build.
let elkInstance: Promise<ElkApi> | null = null;

export function setElk(factory: () => Promise<ElkApi>) {
  elkInstance = factory();
}

function getElk(): Promise<ElkApi> {
  elkInstance ??= import("./elkWorker").then((m) => m.createWorkerElk());
  return elkInstance;
}

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.partitioning.activate": "true",
  // Partitions only constrain within a component, so lay out as one graph.
  "elk.separateConnectedComponents": "false",
  // Keep the given vertical order (rows) where possible: stable maps.
  "elk.layered.crossingMinimization.semiInteractive": "true",
  // Brandes–Köpf placement: ~10× faster than network simplex on timeline
  // graphs (long edges across many year columns), with similar quality.
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.thoroughness": "4",
  "elk.layered.spacing.nodeNodeBetweenLayers": "84",
  "elk.layered.spacing.edgeNodeBetweenLayers": "22",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  // Room for the badges that protrude below each card.
  "elk.spacing.nodeNode": "44",
  "elk.spacing.edgeNode": "18",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.mergeEdges": "false",
  "elk.layered.unnecessaryBendpoints": "false",
};

export type RoutedEdge = LayoutEdge & { id: string };

export async function layoutWithElk(nodes: LayoutNode[], edges: RoutedEdge[]): Promise<RoutedLayout> {
  if (nodes.length === 0) return { positions: new Map(), columns: [], routes: new Map() };
  const { column } = assignColumns(nodes, edges);
  const ids = new Set(nodes.map((n) => n.id));
  // Model order = row order, which semi-interactive crossing minimization keeps.
  const ordered = [...nodes].sort((a, b) => a.row - b.row);
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  // One port per edge end: edges sharing a port become a branching hyperedge
  // in ELK, and separate ports spread arrows along the card side.
  const ports = new Map<string, { id: string; layoutOptions: Record<string, string> }[]>();
  const addPort = (node: string, id: string, side: "WEST" | "EAST") =>
    ports.set(node, [...(ports.get(node) ?? []), { id, layoutOptions: { "elk.port.side": side } }]);
  for (const e of valid) {
    addPort(e.source, `${e.id}|s`, "EAST");
    addPort(e.target, `${e.id}|t`, "WEST");
  }
  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: ordered.map((n) => ({
      id: n.id,
      width: NODE_W,
      height: n.height ?? NODE_H,
      x: (column.get(n.id) ?? 0) * NODE_W,
      y: n.row * ROW_H,
      layoutOptions: {
        "elk.partitioning.partition": String(column.get(n.id) ?? 0),
        "elk.portConstraints": "FIXED_SIDE",
      },
      ports: ports.get(n.id) ?? [],
    })),
    edges: valid.map((e): ElkExtendedEdge => ({ id: e.id, sources: [`${e.id}|s`], targets: [`${e.id}|t`] })),
  };

  const out = await (await getElk()).layout(graph);
  const positions = new Map<string, Point>();
  for (const c of out.children ?? []) positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });

  const routes = new Map<string, Point[]>();
  for (const e of out.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y })));
  }

  // Ruler: one label per column at the left edge of its cards.
  const columnX = new Map<number, number>();
  for (const n of nodes) {
    const c = column.get(n.id)!;
    const x = positions.get(n.id)!.x;
    columnX.set(c, Math.min(columnX.get(c) ?? Infinity, x));
  }
  const base = assignColumns(nodes, edges).columns;
  const columns = base
    .map((col, i) => ({ ...col, x: columnX.get(i) ?? NaN }))
    .filter((col) => Number.isFinite(col.x));
  return { positions, columns, routes };
}
