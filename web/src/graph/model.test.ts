import { describe, expect, it } from "vitest";
import { ancestry, lineage, parseConnection, titleKey, yearsBetween, type CausalEdgeType, type EventNodeType } from "./model";

const node = (id: string, title: string): EventNodeType => ({
  id,
  type: "event",
  position: { x: 0, y: 0 },
  data: { title, description: "", row: 0 },
});
const edge = (source: string, target: string, strength: "primary" | "contributing" | "minor" = "contributing"): CausalEdgeType => ({
  id: `${source}-${target}`,
  type: "causal",
  source,
  target,
  data: { strength },
});

describe("titleKey", () => {
  it("ignores articles, dates in parentheses, case and punctuation", () => {
    expect(titleKey("The Protestant Reformation (1517)")).toBe(titleKey("protestant reformation"));
    expect(titleKey("Gutenberg's Printing Press")).toBe(titleKey("Gutenbergs printing press"));
  });

  it("keeps genuinely different events apart", () => {
    expect(titleKey("First World War")).not.toBe(titleKey("Second World War"));
  });
});

describe("lineage", () => {
  // a -> b -> c, x -> b, c -> d ; unrelated: y
  const edges = [edge("a", "b"), edge("b", "c"), edge("x", "b"), edge("c", "d"), edge("y", "z")];

  it("collects every ancestor and descendant", () => {
    const { nodes } = lineage(edges, "b");
    expect([...nodes].sort()).toEqual(["a", "b", "c", "d", "x"]);
  });

  it("includes only edges on the lineage", () => {
    const { edges: ids } = lineage(edges, "c");
    expect([...ids].sort()).toEqual(["a-b", "b-c", "c-d", "x-b"]);
  });

  it("terminates on cycles", () => {
    const { nodes } = lineage([edge("a", "b"), edge("b", "a")], "a");
    expect([...nodes].sort()).toEqual(["a", "b"]);
  });
});

describe("ancestry", () => {
  it("follows the strongest cause back to the root", () => {
    const nodes = [node("a", "A"), node("b", "B"), node("m", "Minor"), node("c", "C")];
    const edges = [edge("a", "b", "primary"), edge("m", "c", "minor"), edge("b", "c", "primary")];
    expect(ancestry(nodes, edges, "c")).toEqual(["A", "B"]);
  });
});

describe("parseConnection", () => {
  it("parses arrow syntax", () => {
    expect(parseConnection("Black Death -> Reformation")).toEqual(["Black Death", "Reformation"]);
    expect(parseConnection("printing press → French Revolution")).toEqual(["printing press", "French Revolution"]);
  });

  it("parses natural questions", () => {
    expect(parseConnection("How did the Treaty of Versailles lead to World War II?")).toEqual([
      "the Treaty of Versailles",
      "World War II",
    ]);
  });

  it("returns null for a plain event", () => {
    expect(parseConnection("Fall of Constantinople")).toBeNull();
  });
});

describe("yearsBetween", () => {
  it("describes the gap", () => {
    expect(yearsBetween(1347, 1517)).toBe("170 years later");
    expect(yearsBetween(1, 1)).toBe("same year");
    expect(yearsBetween(undefined, 1)).toBeNull();
  });
});
