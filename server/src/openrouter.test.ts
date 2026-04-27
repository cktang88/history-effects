import { describe, it, expect } from "vitest";
import { parseJSONLoose } from "./openrouter.ts";

describe("parseJSONLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJSONLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON with surrounding whitespace", () => {
    expect(parseJSONLoose<{ a: number }>('   \n  {"a":1}  \n')).toEqual({ a: 1 });
  });

  it("strips ```json ... ``` markdown fences", () => {
    const raw = '```json\n{"a": 2}\n```';
    expect(parseJSONLoose<{ a: number }>(raw)).toEqual({ a: 2 });
  });

  it("strips bare ``` ... ``` fences", () => {
    const raw = '```\n{"a": 3}\n```';
    expect(parseJSONLoose<{ a: number }>(raw)).toEqual({ a: 3 });
  });

  it("extracts the first balanced { ... } block from prose", () => {
    const raw = 'Sure! Here is the answer:\n{"effects": [{"title": "x"}]}\nLet me know.';
    expect(parseJSONLoose<{ effects: { title: string }[] }>(raw)).toEqual({
      effects: [{ title: "x" }],
    });
  });

  it("handles nested objects when scanning for balanced braces", () => {
    const raw = 'noise {"intermediate": {"title": "T", "description": "D"}, "x": 1} more';
    const out = parseJSONLoose<{ intermediate: { title: string }; x: number }>(raw);
    expect(out.intermediate.title).toBe("T");
    expect(out.x).toBe(1);
  });

  it("throws when no JSON can be found", () => {
    expect(() => parseJSONLoose("just some prose, no JSON here")).toThrow(
      /Could not parse model output/
    );
  });
});
