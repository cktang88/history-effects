// Step 1: pull the most significant entities for every lens from Wikidata.
// Output: pipeline/out/entities.raw.json

import { LENSES, type Lens, type LensId } from "./lenses.ts";
import { chunk, log, qid, sparql, writePipeline, yearOf, type Binding } from "./lib.ts";

export type RawEntity = {
  id: string;
  lenses: LensId[];
  sitelinks: number;
  label?: string;
  description?: string;
  article?: string;
  type?: string;
  start?: number;
  end?: number;
  coord?: [number, number];
  countries: string[];
};

// astronomical object, geographic location, chemical element, chemical entity,
// letter, SI prefix, archaeological site, volcano, cave, disease, constellation,
// taxon, sports discipline, game, atoll
const NOT_INVENTIONS = [
  "Q6999", "Q2221906", "Q11344", "Q113145171", "Q9788", "Q491081", "Q839954", "Q8072", "Q35509",
  "Q12136", "Q8928", "Q16521", "Q2312410", "Q11410", "Q42523",
];

const EXCLUDED_INVENTION_TYPES = ["Q11344", "Q3863", "Q634", "Q2537", "Q523", "Q16521", "Q5", "Q318", "Q83373"];

function rankQuery(lens: Lens): string {
  const head = `SELECT ?item ?sl WHERE {`;
  const tail = `?item wikibase:sitelinks ?sl . FILTER(?sl >= ${lens.minSitelinks}) } ORDER BY DESC(?sl) LIMIT ${lens.limit}`;
  if ("classes" in lens) {
    const unions = lens.classes.map((c) => `{ ?item wdt:P31/wdt:P279* wd:${c} . }`).join(" UNION ");
    return `${head} ${unions} ${tail}`;
  }
  if ("occupations" in lens) {
    return `${head} ?item wdt:P31 wd:Q5 ; wdt:P106 ?occ . VALUES ?occ { ${lens.occupations.map((o) => `wd:${o}`).join(" ")} } ${tail}`;
  }
  const excluded = EXCLUDED_INVENTION_TYPES.map((t) => `wd:${t}`).join(", ");
  // Places, celestial bodies, sports etc. also have a "time of discovery";
  // the build step filters those out by type.
  return `${head} ?item wdt:P575 ?when . FILTER NOT EXISTS { ?item wdt:P31 ?t . FILTER(?t IN (${excluded})) } ${tail}`;
}

export function detailsQuery(ids: string[], withSitelinks = false): string {
  return `
SELECT ?item ${withSitelinks ? "(SAMPLE(?sl) AS ?sl) " : ""}(SAMPLE(?label) AS ?label) (SAMPLE(?desc) AS ?desc) (SAMPLE(?article) AS ?article)
  (SAMPLE(?typeLabel) AS ?type) (MIN(?s) AS ?start) (MAX(?e) AS ?end) (SAMPLE(?coord) AS ?coord)
  (GROUP_CONCAT(DISTINCT STR(?country); separator=" ") AS ?countries)
WHERE {
  VALUES ?item { ${ids.map((i) => `wd:${i}`).join(" ")} }
  OPTIONAL { ?item rdfs:label ?label . FILTER(lang(?label) = "en") }
  OPTIONAL { ?item schema:description ?desc . FILTER(lang(?desc) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  OPTIONAL { ?item wdt:P31 ?t . ?t rdfs:label ?typeLabel . FILTER(lang(?typeLabel) = "en") }
  OPTIONAL { ?item wdt:P580|wdt:P585|wdt:P571|wdt:P569|wdt:P575 ?s . }
  OPTIONAL { ?item wdt:P582|wdt:P576|wdt:P570 ?e . }
  OPTIONAL { ?item wdt:P625|wdt:P276/wdt:P625|wdt:P36/wdt:P625|wdt:P19/wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P17|wdt:P27|wdt:P276/wdt:P17|wdt:P495 ?country . }${withSitelinks ? "\n  OPTIONAL { ?item wikibase:sitelinks ?sl . }" : ""}
}
GROUP BY ?item`;
}

const value = (b: Binding, k: string) => b[k]?.value || undefined;

function parsePoint(wkt?: string): [number, number] | undefined {
  const m = wkt?.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
  return m ? [Number(m[2]), Number(m[1])] : undefined;
}

export function parseDetails(rows: Binding[]): RawEntity[] {
  return rows.map((r) => {
    const article = value(r, "article");
    return {
      id: qid(r.item!.value),
      lenses: [],
      sitelinks: Number(value(r, "sl") ?? 0),
      label: value(r, "label"),
      description: value(r, "desc"),
      article: article ? decodeURIComponent(article.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ") : undefined,
      type: value(r, "type"),
      start: yearOf(value(r, "start")),
      end: yearOf(value(r, "end")),
      coord: parsePoint(value(r, "coord")),
      countries: (value(r, "countries") ?? "").split(" ").filter(Boolean).map(qid),
    };
  });
}

async function main() {
  const byId = new Map<string, RawEntity>();
  for (const lens of LENSES) {
    if (lens.limit === 0) continue;
    const rows = await sparql(rankQuery(lens));
    let added = 0;
    for (const r of rows) {
      const id = qid(r.item!.value);
      const existing = byId.get(id);
      if (existing) {
        if (!existing.lenses.includes(lens.id)) existing.lenses.push(lens.id);
        continue;
      }
      byId.set(id, { id, lenses: [lens.id], sitelinks: Number(r.sl!.value), countries: [] });
      added++;
    }
    log(`${lens.id}: ${rows.length} ranked, ${added} new`);
  }

  const ids = [...byId.keys()];
  let done = 0;
  for (const batch of chunk(ids, 150)) {
    for (const d of parseDetails(await sparql(detailsQuery(batch)))) {
      const e = byId.get(d.id);
      if (e) Object.assign(e, { ...d, lenses: e.lenses, sitelinks: e.sitelinks });
    }
    done += batch.length;
    log(`details ${done}/${ids.length}`);
  }

  // "Time of discovery" also covers stars, islands and chemicals: keep only
  // things people made or worked out.
  const inventionIds = [...byId.values()].filter((e) => e.lenses.length === 1 && e.lenses[0] === "invention").map((e) => e.id);
  let dropped = 0;
  for (const batch of chunk(inventionIds, 200)) {
    const rows = await sparql(`
SELECT DISTINCT ?item WHERE {
  VALUES ?item { ${batch.map((i) => `wd:${i}`).join(" ")} }
  VALUES ?bad { ${NOT_INVENTIONS.map((c) => `wd:${c}`).join(" ")} }
  ?item wdt:P31/wdt:P279* ?bad .
}`);
    for (const r of rows) dropped += byId.delete(qid(r.item!.value)) ? 1 : 0;
  }
  log(`dropped ${dropped} non-inventions`);

  await writePipeline("entities.raw.json", [...byId.values()]);
  log(`wrote ${byId.size} entities`);
}

if (import.meta.main) await main();
