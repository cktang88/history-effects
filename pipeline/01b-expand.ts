// Step 1b: grow the entity set by following Wikipedia's own causal links.
// Topics that many of our articles cite in their Background/Causes or
// Aftermath/Legacy sections, but that our class-based queries missed (the
// Reformation, the steam engine, the Columbian Exchange…), are by
// construction high-order pieces of history. Resolve them to Wikidata and
// add them. Re-run after step 3 to iterate.
// Output: rewrites pipeline/out/entities.raw.json

import type { RawEntity } from "./01-entities.ts";
import { detailsQuery, parseDetails } from "./01-entities.ts";
import type { WikiArticle } from "./03-wikipedia.ts";
import { LENSES, type LensId } from "./lenses.ts";
import { chunk, log, qid, readPipeline, sparql, writePipeline, readWiki } from "./lib.ts";

const MIN_CITING_ARTICLES = Number(process.env.EXPAND_MIN ?? 4);
const MAX_NEW = Number(process.env.EXPAND_MAX ?? 900);

// Places, organizations and units are cited constantly as settings or actors,
// not as causes or effects; leave them out.
export const SETTING_TYPES =
  /^(country|sovereign state|constituent country.*|city|big city|metropolis|megacity|capital.*|federal capital|county seat|commune.*|municipality.*|.*\bstate of\b.*|u\.s\. state|federated state.*|province.*|region of.*|.*territor.*|administrative.*|hanseatic city|town|village|river|lake|sea|mountain|island|peninsula|political party|army|army group|navy|air force|armed forces|military unit|military branch|intelligence agency|organization|nonprofit organization|company|business|newspaper|website|magazine|university|position|ethnic group|historical ethnic group|currency|roman province|human settlement|neighborhood|building|church building|castle|palace)$/i;

// settlement, country, sovereign state, river, mountain, island, newspaper,
// periodical, website, language, chemical element, business, university,
// political party, military unit, armed forces, body of water, territorial entity
export const SETTING_CLASSES = [
  "Q486972", "Q6256", "Q3624078", "Q4022", "Q8502", "Q23442", "Q11032", "Q1002697", "Q35127",
  "Q34770", "Q11344", "Q4830453", "Q3918", "Q7278", "Q176799", "Q1752346", "Q15324", "Q56061",
];

// Historical polities and cultures are often modeled as subclasses of
// "country", so they're exempt from the settings filter: historical country,
// empire, kingdom, dynasty, archaeological culture, civilization, caliphate,
// sultanate, khaganate.
const POLITY_CLASSES = ["Q3024240", "Q48349", "Q417175", "Q164950", "Q465299", "Q8432", "Q12560", "Q849866", "Q1371288"];

// Items that are places, organizations, languages… (but not historical polities).
export async function settingIds(ids: string[]): Promise<Set<string>> {
  const match = async (classes: string[]) => {
    const found = new Set<string>();
    for (const batch of chunk(ids, 200)) {
      const rows = await sparql(`
SELECT DISTINCT ?item WHERE {
  VALUES ?item { ${batch.map((i) => `wd:${i}`).join(" ")} }
  VALUES ?cls { ${classes.map((c) => `wd:${c}`).join(" ")} }
  ?item wdt:P31/wdt:P279* ?cls .
}`);
      for (const r of rows) found.add(qid(r.item!.value));
    }
    return found;
  };
  const bad = await match(SETTING_CLASSES);
  const polities = await match(POLITY_CLASSES);
  return new Set([...bad].filter((id) => !polities.has(id)));
}

export function lensFromType(type: string | undefined, isHuman: boolean): LensId {
  const t = (type ?? "").toLowerCase();
  if (isHuman || t === "human") return "leader";
  if (/religio|ideolog|philosoph|doctrine|belief|school of thought|theolog|denomination|political movement/.test(t)) return "idea";
  if (/intergovernmental|international organization|military alliance|alliance|league/.test(t)) return "treaty";
  if (/\bbattle|siege|offensive|operation|landing|raid\b/.test(t)) return "battle";
  if (/\bwar|conflict|invasion|conquest|campaign\b/.test(t)) return "war";
  if (/revolution|rebellion|uprising|revolt|coup|insurrection|protest/.test(t)) return "revolution";
  if (/treaty|agreement|pact|convention|accord|peace|charter|declaration|edict|act of parliament|law|constitution/.test(t)) return "treaty";
  if (/country|empire|kingdom|dynasty|state|caliphate|sultanate|khanate|republic|confederation|polity|shogunate/.test(t)) return "state";
  if (/religion|ideology|philosophy|doctrine|belief|school of thought|political movement|religious movement|theology|denomination/.test(t)) return "idea";
  if (/pandemic|epidemic|famine|earthquake|eruption|disaster|outbreak/.test(t)) return "disaster";
  if (/genocide|massacre|pogrom|ethnic cleansing/.test(t)) return "atrocity";
  if (/period|era|age|movement|dynasty|culture|civilization/.test(t)) return "period";
  if (/invention|technology|machine|device|engine|process|technique|tool/.test(t)) return "invention";
  return "event";
}

async function main() {
  const entities = await readPipeline<RawEntity[]>("entities.raw.json");
  const wiki = await readWiki<WikiArticle[]>();
  const known = new Set<string>();
  for (const e of entities) if (e.article) known.add(e.article);
  for (const a of wiki) for (const r of a.redirects) known.add(r);

  // Count distinct citing articles per missing target.
  const citing = new Map<string, Set<string>>();
  for (const a of wiki) {
    for (const l of a.links) {
      if (known.has(l.target) || /^(List of|Timeline of|History of|Category:|Wikipedia:|Portal:)/.test(l.target)) continue;
      const set = citing.get(l.target) ?? new Set<string>();
      set.add(a.title);
      citing.set(l.target, set);
    }
  }
  const ranked = [...citing]
    .filter(([, s]) => s.size >= MIN_CITING_ARTICLES)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_NEW * 2)
    .map(([t]) => t);
  log(`${ranked.length} frequently cited topics missing; top: ${ranked.slice(0, 15).join(", ")}`);

  // Resolve titles to Wikidata items via their English Wikipedia sitelink.
  const ids = new Map<string, string>();
  const humans = new Set<string>();
  for (const batch of chunk(ranked, 200)) {
    const values = batch.map((t) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`).join(" ");
    const rows = await sparql(`
SELECT ?item ?name ?human WHERE {
  VALUES ?name { ${values} }
  ?article schema:name ?name ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?item .
  BIND(EXISTS { ?item wdt:P31 wd:Q5 } AS ?human)
}`);
    for (const r of rows) {
      const id = qid(r.item!.value);
      ids.set(id, r.name!.value);
      if (r.human?.value === "true") humans.add(id);
    }
  }

  const existing = new Set(entities.map((e) => e.id));
  const candidates = [...ids.keys()].filter((id) => !existing.has(id));
  const settings = await settingIds(candidates);
  const fresh = candidates.filter((id) => !settings.has(id) || humans.has(id));
  log(`${settings.size} places/organizations/languages filtered out`);
  // People: rulers/politicians/commanders → leader, everyone else → thinker.
  const leaderOccupations = (LENSES.find((l) => l.id === "leader") as { occupations: string[] }).occupations;
  const leaders = new Set<string>();
  for (const batch of chunk(fresh.filter((id) => humans.has(id)), 200)) {
    const rows = await sparql(`
SELECT DISTINCT ?item WHERE {
  VALUES ?item { ${batch.map((i) => `wd:${i}`).join(" ")} }
  VALUES ?occ { ${leaderOccupations.map((o) => `wd:${o}`).join(" ")} }
  ?item wdt:P106 ?occ .
}`);
    for (const r of rows) leaders.add(qid(r.item!.value));
  }
  const added: RawEntity[] = [];
  for (const batch of chunk(fresh, 150)) {
    const rows = await sparql(detailsQuery(batch, true));
    for (const e of parseDetails(rows)) {
      if (e.start === undefined || e.sitelinks < 15 || (e.type && SETTING_TYPES.test(e.type))) continue;
      e.lenses = humans.has(e.id) ? [leaders.has(e.id) ? "leader" : "thinker"] : [lensFromType(e.type, false)];
      added.push(e);
    }
  }
  added.sort((a, b) => b.sitelinks - a.sitelinks);
  const take = added.slice(0, MAX_NEW);
  await writePipeline("entities.raw.json", [...entities, ...take]);
  const byLens = take.reduce<Record<string, number>>((m, e) => ((m[e.lenses[0]!] = (m[e.lenses[0]!] ?? 0) + 1), m), {});
  log(`added ${take.length} entities ${JSON.stringify(byLens)}; e.g. ${take.slice(0, 20).map((e) => e.label).join(", ")}`);
}

if (import.meta.main) await main();
