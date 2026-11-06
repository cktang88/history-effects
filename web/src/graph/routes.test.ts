import { describe, expect, it } from "vitest";
import { attachRoute, pointAlong, roundedPath, flowPath, midArrow } from "./routes";

describe("roundedPath", () => {
  it("draws straight lines and rounds corners", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe("M 0 0 L 100 0");
    expect(roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }], 10)).toBe("M 0 0 L 40 0 Q 50 0 50 10 L 50 100");
  });

  it("shrinks the radius on short segments and ignores duplicate points", () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }], 12);
    expect(d).toBe("M 0 0 L 7 0 Q 10 0 10 3 L 10 6");
  });
});

describe("pointAlong", () => {
  it("finds the midpoint by length", () => {
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 0 });
  });
});

describe("attachRoute", () => {
  it("moves the ends with their nodes and blends the middle", () => {
    const route = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }];
    const out = attachRoute(route, { x: -10, y: 0 }, { x: 10, y: 20 });
    expect(out[0]).toEqual({ x: -10, y: 0 });
    expect(out[3]).toEqual({ x: 110, y: 60 });
    expect(out[1]).toEqual({ x: 50, y: 10 });
  });

  it("is the identity at rest", () => {
    const route = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(attachRoute(route, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual(route);
  });
});

describe("flowPath", () => {
  it("turns a vertical jog into an S-curve with horizontal tangents", () => {
    const d = flowPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }]);
    expect(d.startsWith("M 0 0")).toBe(true);
    const c = d.match(/C ([\d. -]+)/)![1]!.trim().split(/\s+/).map(Number);
    // Control points sit on the jog; the curve ends back on the horizontal run.
    expect(c.slice(0, 4)).toEqual([100, 0, 100, 80]);
    expect(c[5]).toBe(80);
    expect(c[4]).toBeGreaterThan(100);
    expect(d.endsWith("L 200 80")).toBe(true);
  });
  it("draws a straight route as a line", () => {
    expect(flowPath([{ x: 0, y: 5 }, { x: 50, y: 5 }, { x: 90, y: 5 }])).toBe("M 0 5 L 90 5");
  });
});

describe("midArrow", () => {
  it("points along the longest horizontal run", () => {
    const a = midArrow([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 100 }, { x: 300, y: 100 }])!;
    expect(a).toMatchObject({ x: 170, y: 100, angle: 0 });
    expect(a.length).toBe(400);
  });
});
