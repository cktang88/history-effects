// Step 2: Wikidata relations between our entities (causal and structural),
// plus country → continent so every entity can be placed in a region.
// Output: pipeline/out/relations.raw.json, pipeline/out/countries.raw.json

import type { RawEntity } from "./01-entities.ts";
import { cachedPerId, chunk, log, qid, readPipeline, sparql, writePipeline } from "./lib.ts";

export const PROPERTIES: Record<string, string> = {
  P828: "has_cause",
  P1478: "has_immediate_cause",
  P1479: "has_contributing_factor",
  P1542: "has_effect",
  P1536: "immediate_cause_of",
  P1537: "contributing_factor_of",
  P361: "part_of",
  P155: "follows",
  P156: "followed_by",
  P1365: "replaces",
  P1366: "replaced_by",
  P710: "participant",
  P1344: "participant_in",
  P607: "conflict",
  P793: "significant_event",
  P35: "head_of_state",
  P6: "head_of_government",
  P737: "influenced_by",
};

export type RawRelation = { a: string; p: string; b: string };
export type RawCountry = { id: string; label?: string; continents: string[] };

async function main() {
  const entities = await readPipeline<RawEntity[]>("entities.raw.json");
  const ids = new Set(entities.map((e) => e.id));
  const props = Object.keys(PROPERTIES).map((p) => `wdt:${p}`).join(" ");

  const perEntity = await cachedPerId("relations", [...ids], 250, async (batch) => {
    const out = new Map<string, { p: string; b: string }[]>();
    const rows = await sparql(
      `SELECT ?a ?p ?b WHERE { VALUES ?a { ${batch.map((i) => `wd:${i}`).join(" ")} } VALUES ?p { ${props} } ?a ?p ?b . FILTER(isIRI(?b)) }`
    );
    for (const r of rows) {
      const a = qid(r.a!.value);
      out.set(a, [...(out.get(a) ?? []), { p: qid(r.p!.value), b: qid(r.b!.value) }]);
    }
    return out;
  });
  // Cached per entity with all targets; filter to the current entity set here.
  const relations: RawRelation[] = [];
  for (const [a, rels] of perEntity) for (const r of rels ?? []) if (ids.has(r.b)) relations.push({ a, p: r.p, b: r.b });
  await writePipeline("relations.raw.json", relations);

  const countryIds = [...new Set(entities.flatMap((e) => e.countries))];
  const countries = new Map<string, RawCountry>();
  for (const batch of chunk(countryIds, 300)) {
    const rows = await sparql(`
SELECT ?c ?label ?continent WHERE {
  VALUES ?c { ${batch.map((i) => `wd:${i}`).join(" ")} }
  OPTIONAL { ?c rdfs:label ?label . FILTER(lang(?label) = "en") }
  OPTIONAL { ?c wdt:P30 ?continent . }
}`);
    for (const r of rows) {
      const id = qid(r.c!.value);
      const c = countries.get(id) ?? { id, label: r.label?.value, continents: [] };
      const cont = r.continent && qid(r.continent.value);
      if (cont && !c.continents.includes(cont)) c.continents.push(cont);
      countries.set(id, c);
    }
  }
  await writePipeline("countries.raw.json", [...countries.values()]);
  log(`wrote ${relations.length} relations, ${countries.size} countries`);
}

if (import.meta.main) await main();
