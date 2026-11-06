// Timeline layout. Columns are ordered by year (ordinal, so a 300-year gap
// doesn't leave a 300-column void) and each node keeps its persistent `row`,
// so the map stays recognizable as it grows; only overlaps are resolved.

export const COL_W = 320;
export const ROW_H = 160;
// Fallback card height before a card has been measured.
export const NODE_H = 140;
// Below this zoom, cards switch to overview mode (date + large title); the
// canvas can't zoom out further than the point where that text would drop
// under 12px on screen.
export const DETAIL_ZOOM = 0.9;
export const MIN_ZOOM = 0.45;
export const NODE_W = 264;
const GAP = 22;

export type LayoutNode = { id: string; year?: number; row: number; height?: number };
export type LayoutEdge = { source: string; target: string };

export type Column = { x: number; year: number; label: string; gapBefore: number };

export type Layout = {
  positions: Map<string, { x: number; y: number }>;
  columns: Column[];
};

export function inferYears(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, number> {
  const years = new Map<string, number>();
  for (const n of nodes) if (n.year !== undefined) years.set(n.id, n.year);
  for (let pass = 0; pass < 4 && years.size < nodes.length; pass++) {
    for (const e of edges) {
      const s = years.get(e.source);
      const t = years.get(e.target);
      if (s !== undefined && t === undefined) years.set(e.target, s);
      else if (t !== undefined && s === undefined) years.set(e.source, t);
    }
  }
  for (const n of nodes) if (!years.has(n.id)) years.set(n.id, 0);
  return years;
}

// Within a cluster, a cause still has to sit left of its effect. Depths come
// from a topological pass; edges closing a cycle are ignored, so a cyclic
// group can't stretch into one column per node.
function sameYearDepths(ids: string[], edges: LayoutEdge[]): Map<string, number> {
  const inGroup = new Set(ids);
  const local = edges.filter((e) => inGroup.has(e.source) && inGroup.has(e.target) && e.source !== e.target);
  const depth = new Map(ids.map((id) => [id, 0]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const e of local) {
    indeg.set(e.target, indeg.get(e.target)! + 1);
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  }
  const done = new Set<string>();
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const settle = (id: string) => {
    done.add(id);
    for (const t of out.get(id) ?? []) {
      if (done.has(t)) continue;
      depth.set(t, Math.max(depth.get(t)!, depth.get(id)! + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  };
  for (;;) {
    while (queue.length) settle(queue.shift()!);
    // Only cycles remain: break one by settling its first member as is.
    const next = ids.find((id) => !done.has(id));
    if (!next) break;
    settle(next);
  }
  return depth;
}

function formatYear(year: number): string {
  return year < 0 ? `${-year} BCE` : `${year}`;
}

// Years close together share a cluster; inside a cluster, causal order (not
// the exact year) decides the sub-column. Keeps dense periods compact.
const CLUSTER_YEARS = 3;

function clusterYears(years: number[]): number[][] {
  const clusters: number[][] = [];
  for (const y of [...new Set(years)].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    if (last && y - last[0]! <= CLUSTER_YEARS) last.push(y);
    else clusters.push([y]);
  }
  return clusters;
}

function rangeLabel(years: number[]): string {
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  if (lo === hi) return formatYear(lo);
  if (lo >= 0 && Math.floor(lo / 100) === Math.floor(hi / 100)) return `${lo}–${String(hi).slice(-2)}`;
  return `${formatYear(lo)}–${formatYear(hi)}`;
}

function assignColumns(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const years = inferYears(nodes, edges);
  const column = new Map<string, number>();
  const columns: Column[] = [];
  let offset = 0;
  let prevYear: number | null = null;
  for (const cluster of clusterYears([...years.values()])) {
    const inCluster = new Set(cluster);
    const ids = nodes.filter((n) => inCluster.has(years.get(n.id)!)).map((n) => n.id);
    const depths = sameYearDepths(ids, edges);
    const width = Math.max(...depths.values()) + 1;
    for (const id of ids) column.set(id, offset + depths.get(id)!);
    for (let k = 0; k < width; k++) {
      const colYears = ids.filter((id) => depths.get(id) === k).map((id) => years.get(id)!);
      const year = colYears.length ? Math.min(...colYears) : cluster[0]!;
      columns.push({
        x: (offset + k) * COL_W,
        year,
        label: colYears.length ? rangeLabel(colYears) : "",
        gapBefore: k === 0 && prevYear !== null ? year - prevYear : 0,
      });
    }
    prevYear = Math.max(...cluster);
    offset += width;
  }
  return { column, columns };
}

// Place nodes at their preferred y, pushing apart any that overlap, then
// re-center the block so pushes don't drift everything downward.
function resolveColumn(items: { id: string; want: number; h: number }[]) {
  const sorted = [...items].sort((a, b) => a.want - b.want);
  const placed: { id: string; y: number }[] = [];
  let cursor = -Infinity;
  for (const it of sorted) {
    const y = Math.max(it.want, cursor);
    placed.push({ id: it.id, y });
    cursor = y + it.h + GAP;
  }
  const drift = placed.reduce((s, p, i) => s + (p.y - sorted[i]!.want), 0) / Math.max(1, placed.length);
  return placed.map((p) => ({ id: p.id, y: p.y - drift / 2 }));
}

export function layoutTimeline(nodes: LayoutNode[], edges: LayoutEdge[]): Layout {
  const { column, columns } = assignColumns(nodes, edges);
  const byColumn = new Map<number, { id: string; want: number; h: number }[]>();
  for (const n of nodes) {
    const c = column.get(n.id)!;
    byColumn.set(c, [...(byColumn.get(c) ?? []), { id: n.id, want: n.row * ROW_H, h: n.height ?? NODE_H }]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [c, items] of byColumn) {
    for (const p of resolveColumn(items)) positions.set(p.id, { x: c * COL_W, y: p.y });
  }
  return { positions, columns };
}

// Rows for k new neighbors fanned around a parent, ordered by year so their
// edges don't cross each other.
export function fanRows(center: number, count: number, spacing = 1): number[] {
  return Array.from({ length: count }, (_, i) => center + (i - (count - 1) / 2) * spacing);
}
