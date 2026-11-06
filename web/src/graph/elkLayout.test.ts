import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ELK from "elkjs/lib/elk.bundled.js";
import { layoutWithElk, setElk, type RoutedLayout } from "./elkLayout";

setElk(async () => new ELK());
import { NODE_W } from "./layout";

type Box = { id: string; x: number; y: number; w: number; h: number };

function quality(layout: RoutedLayout, nodes: { id: string; year: number; height: number }[]) {
  const boxes: Box[] = nodes.map((n) => ({ id: n.id, ...layout.positions.get(n.id)!, w: NODE_W, h: n.height }));
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
    }
  let through = 0;
  for (const [id, pts] of layout.routes) {
    const [s, t] = id.split(">");
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k]!, q = pts[k + 1]!;
      for (let f = 0.05; f < 1; f += 0.05) {
        const x = p.x + (q.x - p.x) * f, y = p.y + (q.y - p.y) * f;
        for (const b of boxes) if (b.id !== s && b.id !== t && x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1) through++;
      }
    }
  }
  // Within a cluster of nearby years causal order wins, so only count
  // inversions between events more than 3 years apart.
  let inversions = 0;
  for (const a of nodes)
    for (const b of nodes)
      if (b.year - a.year > 3 && layout.positions.get(b.id)!.x + 1 < layout.positions.get(a.id)!.x) inversions++;
  const orthogonal = [...layout.routes.values()].every((pts) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1]!.x) < 0.5 || Math.abs(p.y - pts[i - 1]!.y) < 0.5));
  return { overlaps, through, inversions, orthogonal };
}

describe("layoutWithElk", () => {
  it("lays out a real neighborhood without overlaps, with orthogonal routes around cards, in time order", async () => {
    const root = new URL("../../../data/", import.meta.url);
    const entities = JSON.parse(readFileSync(new URL("entities.json", root), "utf8")) as { id: string; title: string; start: number }[];
    const links = JSON.parse(readFileSync(new URL("links.json", root), "utf8")) as { s: string; t: string }[];
    const start = entities.find((e) => e.title === "French Revolution")!;
    const pick = new Set([start.id]);
    for (let hop = 0; hop < 2; hop++)
      for (const l of links) if ((pick.has(l.s) || pick.has(l.t)) && pick.size < 60) (pick.add(l.s), pick.add(l.t));
    const nodes = entities
      .filter((e) => pick.has(e.id))
      .map((e, i) => ({ id: e.id, year: e.start, row: (i % 7) - 3, height: 110 + (e.title.length > 28 ? 26 : 0) }));
    const edges = links.filter((l) => pick.has(l.s) && pick.has(l.t)).map((l) => ({ id: `${l.s}>${l.t}`, source: l.s, target: l.t }));

    const t0 = performance.now();
    const layout = await layoutWithElk(nodes, edges);
    const ms = performance.now() - t0;
    const q = quality(layout, nodes);
    console.log(`nodes ${nodes.length} edges ${edges.length} routed ${layout.routes.size} in ${ms.toFixed(0)}ms`, q);

    expect(layout.routes.size).toBe(edges.length);
    expect(q.overlaps).toBe(0);
    expect(q.through).toBe(0);
    expect(q.inversions).toBe(0);
    expect(ms).toBeLessThan(1500);
    expect(q.orthogonal).toBe(true);
  });

  it("handles empty and single-node graphs", async () => {
    expect((await layoutWithElk([], [])).positions.size).toBe(0);
    const one = await layoutWithElk([{ id: "a", year: 1, row: 0 }], []);
    expect(one.positions.get("a")).toBeDefined();
    expect(one.columns).toHaveLength(1);
  });
});
