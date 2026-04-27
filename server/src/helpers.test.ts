import { describe, it, expect } from "vitest";
import { clampN, normalizeStrength, sanitizeList, renderEventPrompt } from "./helpers.ts";

describe("clampN", () => {
  it("uses the fallback when value is not a number", () => {
    expect(clampN(undefined, 5)).toBe(5);
    expect(clampN("foo", 5)).toBe(5);
    expect(clampN(null, 5)).toBe(5);
  });

  it("clamps below 1 to 1 and above 8 to 8", () => {
    expect(clampN(0, 5)).toBe(1);
    expect(clampN(-3, 5)).toBe(1);
    expect(clampN(99, 5)).toBe(8);
  });

  it("floors fractional values", () => {
    expect(clampN(3.7, 5)).toBe(3);
  });

  it("uses fallback for NaN/Infinity", () => {
    expect(clampN(NaN, 5)).toBe(5);
    expect(clampN(Infinity, 5)).toBe(5);
  });
});

describe("normalizeStrength", () => {
  it("returns valid strengths unchanged", () => {
    expect(normalizeStrength("primary")).toBe("primary");
    expect(normalizeStrength("contributing")).toBe("contributing");
    expect(normalizeStrength("minor")).toBe("minor");
  });

  it("falls back to 'contributing' for invalid input", () => {
    expect(normalizeStrength("strong")).toBe("contributing");
    expect(normalizeStrength(undefined)).toBe("contributing");
    expect(normalizeStrength(42)).toBe("contributing");
    expect(normalizeStrength(null)).toBe("contributing");
  });
});

describe("sanitizeList", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeList(null, 5)).toEqual([]);
    expect(sanitizeList({}, 5)).toEqual([]);
    expect(sanitizeList("foo", 5)).toEqual([]);
  });

  it("filters out non-objects", () => {
    expect(sanitizeList([null, "a", 1, { title: "T" }], 5)).toHaveLength(1);
  });

  it("trims fields and applies defaults", () => {
    const result = sanitizeList(
      [{ title: "  Hello  ", description: " desc ", strength: "primary", reasoning: " r " }],
      5
    );
    expect(result[0]).toEqual({
      title: "Hello",
      description: "desc",
      strength: "primary",
      reasoning: "r",
    });
  });

  it("falls back to 'Untitled' for empty/missing title", () => {
    expect(sanitizeList([{ description: "x" }], 5)[0]?.title).toBe("Untitled");
    expect(sanitizeList([{ title: "  " }], 5)[0]?.title).toBe("Untitled");
  });

  it("normalizes invalid strength to 'contributing'", () => {
    expect(sanitizeList([{ title: "T", strength: "huge" }], 5)[0]?.strength).toBe("contributing");
  });

  it("respects the n cap", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}` }));
    expect(sanitizeList(items, 3)).toHaveLength(3);
  });
});

describe("renderEventPrompt", () => {
  it("includes title, description, and instruction", () => {
    const out = renderEventPrompt(
      { title: "WW1", description: "Global war 1914-1918." },
      "List effects."
    );
    expect(out).toContain("Title: WW1");
    expect(out).toContain("Description: Global war 1914-1918.");
    expect(out).toContain("List effects.");
  });

  it("handles missing description without throwing", () => {
    const out = renderEventPrompt({ title: "X", description: "" }, "Go.");
    expect(out).toContain("Description: ");
    expect(out).toContain("Go.");
  });
});
