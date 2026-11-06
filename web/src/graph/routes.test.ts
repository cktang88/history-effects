import { describe, expect, it } from "vitest";
import { attachRoute, pointAlong, roundedPath } from "./routes";

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
