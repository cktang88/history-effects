import { describe, expect, it } from "vitest";
import { Atlas, type CausalLink, type Entity } from "./atlas.ts";

const e = (id: string, title: string, start: number, extra: Partial<Entity> = {}): Entity => ({
  id,
  title,
  kind: "event",
  lenses: ["event"],
  sig: 50,
  start,
  region: "Europe",
  ...extra,
});

const wiki = (text: string) => ({ src: "wikipedia" as const, article: "A", section: "Aftermath", text });

const entities = [
  e("Q1", "Treaty of Versailles", 1919, { kind: "treaty", lenses: ["treaty"], sig: 120 }),
  e("Q2", "Weimar Republic hyperinflation", 1921, { sig: 40 }),
  e("Q3", "Nazi seizure of power", 1933, { sig: 90 }),
  e("Q4", "World War II", 1939, { kind: "war", lenses: ["war"], sig: 290 }),
  e("Q5", "Versailles Palace", 1682, { sig: 10 }),
  e("Q6", "Meiji Restoration", 1868, { region: "East Asia", sig: 100 }),
  e("Q7", "Otto von Bismarck", 1815, { kind: "leader", lenses: ["leader"], end: 1898, sig: 110 }),
];

const links: CausalLink[] = [
  { s: "Q1", t: "Q2", score: 2, ev: [wiki("reparations")] },
  { s: "Q2", t: "Q3", score: 2, ev: [wiki("crisis")] },
  { s: "Q3", t: "Q4", score: 5, ev: [{ src: "wikidata", prop: "has cause" }] },
  { s: "Q1", t: "Q4", score: 0.9, ev: [wiki("weak direct")] },
  { s: "Q6", t: "Q4", score: 1, ev: [wiki("dubious")] },
];

describe("Atlas", () => {
  const atlas = new Atlas(entities, links, [{ s: "Q2", t: "Q3", rel: "followed_by" }]);

  it("ranks exact and prefix title matches first", () => {
    expect(atlas.search("treaty of versailles")[0]!.id).toBe("Q1");
    expect(atlas.search("versailles").map((r) => r.id)).toEqual(["Q1", "Q5"]);
    expect(atlas.search("  ")).toEqual([]);
  });

  it("browses an era/region/lens slice by significance", () => {
    expect(atlas.browse({ from: 1910, to: 1940 }).items.map((x) => x.id)).toEqual(["Q4", "Q1", "Q3", "Q2"]);
    expect(atlas.browse({ from: 1860, to: 1870, region: "East Asia" }).items.map((x) => x.id)).toEqual(["Q6"]);
    expect(atlas.browse({ from: 1860, to: 1870, lens: "leader" }).items.map((x) => x.id)).toEqual(["Q7"]);
  });

  it("returns causes and effects strongest first, with derived strength", () => {
    const d = atlas.detail("Q4")!;
    expect(d.causes.map((l) => l.source)).toEqual(["Q3", "Q6", "Q1"]);
    expect(d.causes[0]!.strength).toBe("primary");
    expect(d.causes[2]!.strength).toBe("minor");
    expect(d.preceded.map((x) => x.id)).toEqual([]);
    expect(atlas.detail("Q3")!.preceded.map((x) => x.id)).toEqual(["Q2"]);
  });

  it("prefers a well-evidenced multi-step chain over a weak direct link", () => {
    expect(atlas.path("Q1", "Q4")!.map((l) => l.target)).toEqual(["Q2", "Q3", "Q4"]);
  });

  it("can look for a chain that avoids the direct link", () => {
    const direct = new Atlas(entities, [...links, { s: "Q1", t: "Q4", score: 9, ev: [] }].filter((l, i, a) => a.findIndex((x) => x.s === l.s && x.t === l.t) === i), []);
    expect(atlas.path("Q1", "Q4", { skipDirect: true })!.map((l) => l.target)).toEqual(["Q2", "Q3", "Q4"]);
    expect(direct.path("Q2", "Q4", { skipDirect: true })!.length).toBe(2);
  });

  it("withholds weak unreviewed links when asked", () => {
    const strict = new Atlas(entities, links, [], { "Q6>Q4": { verdict: "keep", strength: "minor", mechanism: "m" } }, 1.8);
    expect(strict.detail("Q4")!.causes.map((l) => l.source).sort()).toEqual(["Q3", "Q6"]);
  });

  it("adds curated links without overriding sourced ones", () => {
    const withCurated = new Atlas(entities, links, [], {}, 0, {
      "Q6>Q7": { strength: "minor", mechanism: "should be dropped: person as effect is still allowed here but pair is new" },
      "Q1>Q2": { strength: "minor", mechanism: "ignored: a sourced link exists" },
      "Q5>Q1": { strength: "contributing", mechanism: "Signed in the Hall of Mirrors." },
    });
    expect(withCurated.link("Q5", "Q1")).toMatchObject({ reasoning: "Signed in the Hall of Mirrors.", reviewed: true, evidence: [{ src: "curated" }] });
    expect(withCurated.link("Q1", "Q2")!.reasoning).toBe("reparations");
  });

  it("finds no path backwards in time", () => {
    expect(atlas.path("Q4", "Q1")).toBeNull();
  });

  it("applies reviews: rejects, reversals and reviewed mechanisms", () => {
    const reviewed = new Atlas(entities, links, [], {
      "Q6>Q4": { verdict: "reject", strength: "minor", mechanism: "" },
      "Q1>Q2": { verdict: "keep", strength: "primary", mechanism: "Reparations drained German finances." },
    });
    expect(reviewed.detail("Q4")!.causes.map((l) => l.source)).not.toContain("Q6");
    const l = reviewed.link("Q1", "Q2")!;
    expect(l).toMatchObject({ strength: "primary", reasoning: "Reparations drained German finances.", reviewed: true });
  });
});
