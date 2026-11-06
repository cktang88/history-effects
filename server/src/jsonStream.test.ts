import { describe, expect, it } from "vitest";
import { createJsonObjectStream } from "./jsonStream.ts";

function collect(doc: string, chunkSize: number) {
  const out: [string, unknown][] = [];
  const s = createJsonObjectStream((key, value) => out.push([key, value]));
  for (let i = 0; i < doc.length; i += chunkSize) s.feed(doc.slice(i, i + chunkSize));
  return out;
}

describe("createJsonObjectStream", () => {
  const doc = JSON.stringify(
    {
      event: { title: "Black Death", nested: { ignored: true } },
      effects: [
        { title: "A {tricky} \"quoted\" title", list: [1, 2] },
        { title: "B" },
      ],
      verdict: "strong",
    },
    null,
    1
  );

  it("emits top-level objects and array items as they close, whatever the chunking", () => {
    for (const size of [1, 3, 17, doc.length]) {
      expect(collect(doc, size)).toEqual([
        ["event", { title: "Black Death", nested: { ignored: true } }],
        ["effects", { title: 'A {tricky} "quoted" title', list: [1, 2] }],
        ["effects", { title: "B" }],
      ]);
    }
  });

  it("does not emit nested objects on their own", () => {
    const keys = collect(doc, 5).map(([k]) => k);
    expect(keys).not.toContain("nested");
  });

  it("emits nothing for an incomplete trailing object", () => {
    expect(collect('{"effects": [{"title": "A"}, {"title": "B', 4)).toEqual([["effects", { title: "A" }]]);
  });

  it("tolerates prose or fences before the JSON", () => {
    expect(collect('Sure!\n```json\n{"steps": [{"title": "X"}]}\n```', 2)).toEqual([["steps", { title: "X" }]]);
  });
});
