import { describe, expect, it } from "vitest";
import { COL_W, NODE_H, layoutTimeline, inferYears } from "./layout";

describe("layoutTimeline", () => {
  it("orders columns by year, left to right", () => {
    const { positions, columns } = layoutTimeline(
      [
        { id: "late", year: 1900, row: 0 },
        { id: "early", year: 1500, row: 0 },
        { id: "mid", year: 1700, row: 0 },
      ],
      []
    );
    expect(positions.get("early")!.x).toBeLessThan(positions.get("mid")!.x);
    expect(positions.get("mid")!.x).toBeLessThan(positions.get("late")!.x);
    expect(columns.map((c) => c.label)).toEqual(["1500", "1700", "1900"]);
    expect(columns[1]!.gapBefore).toBe(200);
  });

  it("puts a cause left of its effect even within the same year cluster", () => {
    const { positions } = layoutTimeline(
      [
        { id: "effect", year: 1347, row: 0 },
        { id: "cause", year: 1346, row: 0 },
      ],
      [{ source: "cause", target: "effect" }]
    );
    expect(positions.get("effect")!.x - positions.get("cause")!.x).toBe(COL_W);
  });

  it("shares a column for unconnected events a couple of years apart", () => {
    const { positions, columns } = layoutTimeline(
      [
        { id: "a", year: 1348, row: 0 },
        { id: "b", year: 1350, row: 2 },
      ],
      []
    );
    expect(positions.get("a")!.x).toBe(positions.get("b")!.x);
    expect(columns[0]!.label).toBe("1348–50");
  });

  it("separates overlapping cards in the same column", () => {
    const { positions } = layoutTimeline(
      [
        { id: "a", year: 1500, row: 0 },
        { id: "b", year: 1500, row: 0 },
      ],
      []
    );
    expect(Math.abs(positions.get("a")!.y - positions.get("b")!.y)).toBeGreaterThanOrEqual(NODE_H);
  });

  it("keeps a causal cycle within a year cluster compact", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const { columns } = layoutTimeline(
      ids.map((id) => ({ id, year: 1800, row: 0 })),
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
      ]
    );
    expect(columns.length).toBeLessThanOrEqual(3);
  });

  it("labels BCE years", () => {
    const { columns } = layoutTimeline([{ id: "a", year: -44, row: 0 }], []);
    expect(columns[0]!.label).toBe("44 BCE");
  });
});

describe("inferYears", () => {
  it("borrows a year from a linked event when one is missing", () => {
    const years = inferYears(
      [
        { id: "a", year: 1600, row: 0 },
        { id: "b", row: 0 },
      ],
      [{ source: "a", target: "b" }]
    );
    expect(years.get("b")).toBe(1600);
  });
});
