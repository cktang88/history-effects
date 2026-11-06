// Geometry for orthogonal edge routes.

export type Point = { x: number; y: number };

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

// SVG path through an orthogonal polyline with rounded corners. Corner radius
// shrinks on short segments so curves never overshoot.
export function roundedPath(points: Point[], radius = 12): string {
  const pts = dedupe(points);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!, cur = pts[i]!, next = pts[i + 1]!;
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2);
    const a = toward(cur, prev, r);
    const b = toward(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1]!;
  return d + ` L ${last.x} ${last.y}`;
}

function toward(from: Point, to: Point, len: number): Point {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * len, y: from.y + ((to.y - from.y) / d) * len };
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  return out;
}

// Point at a fraction of the polyline's length (for labels/tooltips).
export function pointAlong(points: Point[], fraction = 0.5): Point {
  const pts = dedupe(points);
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  const total = pts.slice(1).reduce((s, p, i) => s + dist(pts[i]!, p), 0);
  let left = total * fraction;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1]!, pts[i]!);
    if (left <= seg) return toward(pts[i - 1]!, pts[i]!, left);
    left -= seg;
  }
  return pts[pts.length - 1]!;
}

// While cards animate to their new positions, deform the final route so its
// ends stay attached: each point shifts by a blend of the source's and the
// target's remaining offset, weighted by its horizontal progress.
export function attachRoute(route: Point[], sourceShift: Point, targetShift: Point): Point[] {
  if (route.length < 2) return route;
  const x0 = route[0]!.x;
  const span = route[route.length - 1]!.x - x0 || 1;
  return route.map((p, i) => {
    const f = i === 0 ? 0 : i === route.length - 1 ? 1 : Math.min(1, Math.max(0, (p.x - x0) / span));
    return { x: p.x + sourceShift.x + (targetShift.x - sourceShift.x) * f, y: p.y + sourceShift.y + (targetShift.y - sourceShift.y) * f };
  });
}

// Smooth "flow" path through an orthogonal route: every vertical jog becomes
// an S-curve with horizontal tangents, borrowing room from the horizontal runs
// on either side. Edges then read as continuous left-to-right strokes, and
// crossings meet at an angle instead of forming ambiguous T and + junctions.
export function flowPath(points: Point[]): string {
  const pts = simplify(points);
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  const isVertical = (i: number) => Math.abs(pts[i + 1]!.x - pts[i]!.x) < 1;
  const segLen = (i: number) => (i >= 0 && i < pts.length - 1 ? dist(pts[i]!, pts[i + 1]!) : 0);
  // Room each jog takes from its neighbours: wider for taller jogs, never more
  // than half of a shared horizontal run.
  const width = (i: number) => {
    const dy = Math.abs(pts[i + 1]!.y - pts[i]!.y);
    return Math.min(52, 16 + dy * 0.35);
  };
  const trimStart = Array.from({ length: pts.length }, () => 0); // trim at the start of segment i
  const trimEnd = Array.from({ length: pts.length }, () => 0); // trim at the end of segment i
  for (let i = 0; i < pts.length - 1; i++) {
    if (!isVertical(i)) continue;
    const w = width(i);
    if (i > 0 && !isVertical(i - 1)) trimEnd[i - 1] = Math.min(w, segLen(i - 1) / (i - 1 > 0 && isVertical(i - 2) ? 2 : 1.2));
    if (i < pts.length - 2 && !isVertical(i + 1)) trimStart[i + 1] = Math.min(w, segLen(i + 1) / (i + 2 < pts.length - 1 && isVertical(i + 2) ? 2 : 1.2));
  }
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (isVertical(i)) {
      const before = i > 0 ? trimEnd[i - 1]! : 0;
      const after = i < pts.length - 2 ? trimStart[i + 1]! : 0;
      if (before === 0 && after === 0) {
        d += ` L ${b.x} ${b.y}`;
        continue;
      }
      const end = i < pts.length - 2 ? toward(b, pts[i + 2]!, after) : b;
      d += ` C ${a.x} ${a.y} ${b.x} ${b.y} ${end.x} ${end.y}`;
    } else {
      const end = trimEnd[i]! > 0 ? toward(b, a, trimEnd[i]!) : b;
      d += ` L ${end.x} ${end.y}`;
    }
  }
  return d;
}

// Drop duplicate and collinear points.
function simplify(points: Point[]): Point[] {
  const pts = dedupe(points);
  const out: Point[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 2]!, b = out[n - 1]!;
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
      if (Math.abs(cross) < 0.5) out[n - 1] = p;
      else out.push(p);
    } else out.push(p);
  }
  return out;
}

// Where to draw a mid-edge direction arrow: the middle of the longest straight
// run (which the flow path follows exactly), with its heading in degrees.
export function midArrow(points: Point[]): { x: number; y: number; angle: number; length: number } | null {
  const pts = simplify(points);
  if (pts.length < 2) return null;
  let best = -1;
  let bestLen = 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = dist(pts[i]!, pts[i + 1]!);
    total += len;
    if (Math.abs(pts[i + 1]!.x - pts[i]!.x) >= 1 && len > bestLen) {
      best = i;
      bestLen = len;
    }
  }
  if (best < 0) return null;
  const a = pts[best]!, b = pts[best + 1]!;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    length: total,
  };
}
