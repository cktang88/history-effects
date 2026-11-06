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
