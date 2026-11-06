// Step 4: merge Wikidata entities/relations and Wikipedia evidence into the
// committed database: data/entities.json and data/links.json.
//
// Causal links come from two independent sources:
//   - Wikidata causal properties (has cause / has effect / …), which are
//     sparse and noisy (e.g. "Japan" listed as an effect of WWII);
//   - Wikipedia: a link to B inside the Background/Causes section of A's
//     article suggests B → A; inside Aftermath/Legacy/Impact, A → B.
// Candidates are checked for temporal sanity, scored by corroboration and
// significance, and pruned to each entity's strongest causes and effects —
// the "high-order bits", not every conceivable influence.

import type { RawEntity } from "./01-entities.ts";
import type { RawCountry, RawRelation } from "./02-relations.ts";
import type { WikiArticle } from "./03-wikipedia.ts";
import { LENSES, type LensId } from "./lenses.ts";
import { log, readPipeline, writeJSONLines, readWiki } from "./lib.ts";
import { regionOf } from "./regions.ts";

export type Kind = LensId;

export type Entity = {
  id: string;
  title: string;
  kind: Kind;
  lenses: LensId[];
  sig: number;
  start: number;
  end?: number;
  region: string;
  country?: string;
  desc?: string;
  summary?: string;
  wiki?: string;
  img?: string;
};

export type Evidence =
  | { src: "wikidata"; prop: string }
  | { src: "wikipedia"; article: string; section: string; text: string };

export type CausalLink = { s: string; t: string; score: number; ev: Evidence[] };
export type StructLink = { s: string; t: string; rel: "part_of" | "participant" | "succeeded_by" | "followed_by" };

const PERSON: LensId[] = ["leader", "thinker"];

const JUNK_TYPES =
  /\b(planet|dwarf planet|island|continent|country|lake|region|sport|game|particle|letter|territory|mountain|galaxy|star|nebula|ocean|sea|river|moon|satellite|comet|asteroid|element|archipelago|peninsula|cape|bay|strait|desert|city|state of|province|ethnic|musical|genre|album|film|song|band|fictional|television|video game|language|alphabet|website|company|brand|unit of|theorem|equation|constant|organ|tissue|animal|plant|species|taxon|isotope|mineral|compound|holiday|festival|sports|football|epoch|eon|era of geologic|geologic)\b/i;

function keepEntity(e: RawEntity): boolean {
  if (!e.label || /^Q\d+$/.test(e.label) || e.start === undefined) return false;
  if (e.start > 2026 || e.start < -12000) return false;
  const k = e.lenses[0];
  if ((k === "invention" || k === "period" || k === "disaster") && e.type && JUNK_TYPES.test(e.type)) return false;
  if (k === "period" && e.start < -12000) return false;
  return true;
}

const CAUSAL_PROPS: Record<string, { dir: "cause_of_a" | "effect_of_a"; weight: number; name: string }> = {
  P828: { dir: "cause_of_a", weight: 2, name: "has cause" },
  P1478: { dir: "cause_of_a", weight: 2.5, name: "has immediate cause" },
  P1479: { dir: "cause_of_a", weight: 1.5, name: "has contributing factor" },
  P1542: { dir: "effect_of_a", weight: 2, name: "has effect" },
  P1536: { dir: "effect_of_a", weight: 2.5, name: "immediate cause of" },
  P1537: { dir: "effect_of_a", weight: 1.5, name: "contributing factor of" },
};

type Candidate = { s: string; t: string; weight: number; ev: Evidence[]; fromCauseArticle: number; fromEffectArticle: number; wikidata: boolean };

function plausible(cause: Entity, effect: Entity): boolean {
  if (cause.id === effect.id) return false;
  if (PERSON.includes(effect.kind)) return false;
  // Allow small slack for coarse dates; a cause may also overlap its effect.
  return cause.start <= effect.start + 2;
}

function kindFactor(cause: Entity, effect: Entity): number {
  let f = 1;
  if (cause.kind === "state" || effect.kind === "state") f *= 0.55;
  if (cause.kind === "period" || effect.kind === "period") f *= 0.75;
  if (PERSON.includes(cause.kind)) f *= 0.85;
  return f;
}

function significance(a: Entity, b: Entity): number {
  return 0.4 + 0.6 * Math.min(1, Math.log10(Math.min(a.sig, b.sig) + 1) / 2.3);
}

const MAX_CAUSES = 12;
const MAX_EFFECTS = 14;
const MIN_SCORE = 0.8;

async function main() {
  const raw = await readPipeline<RawEntity[]>("entities.raw.json");
  const relations = await readPipeline<RawRelation[]>("relations.raw.json");
  const countries = new Map((await readPipeline<RawCountry[]>("countries.raw.json")).map((c) => [c.id, c]));
  const wiki = await readWiki<WikiArticle[]>();
  let images: Record<string, string> = {};
  try {
    images = await readPipeline<Record<string, string>>("images.json");
  } catch {}
  const articleOf = new Map(wiki.map((a) => [a.title, a]));

  // Keep the top invention-lens items after type filtering.
  const kept = raw.filter(keepEntity);
  const entities = new Map<string, Entity>();
  for (const e of kept) {
    const continents = e.countries.flatMap((c) => countries.get(c)?.continents ?? []);
    const region = regionOf(e.coord, continents);
    // A war fought by twenty countries has no single country.
    const country = region === "Global" || e.countries.length > 3 ? undefined : e.countries.map((c) => countries.get(c)).find((c) => c?.label);
    const article = e.article ? articleOf.get(e.article) : undefined;
    entities.set(e.id, {
      id: e.id,
      // Wikipedia titles are properly cased and disambiguated ("Siege of
      // Constantinople (1453)"); Wikidata labels often aren't.
      title: e.article ?? e.label!.charAt(0).toUpperCase() + e.label!.slice(1),
      kind: e.lenses[0]!,
      lenses: e.lenses,
      sig: e.sitelinks,
      start: e.start!,
      end: e.end !== undefined && e.end >= e.start! ? e.end : undefined,
      region,
      country: country?.label,
      desc: e.description,
      summary: article?.summary || undefined,
      wiki: e.article,
      img: images[e.id],
    });
  }
  log(`entities: ${raw.length} raw → ${entities.size} kept`);

  // Title (and redirect) → entity, for resolving Wikipedia links.
  const byTitle = new Map<string, string>();
  for (const e of kept) {
    if (!e.article || !entities.has(e.id)) continue;
    byTitle.set(e.article, e.id);
    for (const r of articleOf.get(e.article)?.redirects ?? []) if (!byTitle.has(r)) byTitle.set(r, e.id);
  }

  const candidates = new Map<string, Candidate>();
  const add = (s: string, t: string, weight: number, ev: Evidence, side?: "cause" | "effect") => {
    const cause = entities.get(s);
    const effect = entities.get(t);
    if (!cause || !effect || !plausible(cause, effect)) return;
    const key = `${s}>${t}`;
    const c = candidates.get(key) ?? { s, t, weight: 0, ev: [], fromCauseArticle: 0, fromEffectArticle: 0, wikidata: false };
    if (ev.src === "wikidata") {
      if (c.wikidata) return;
      c.wikidata = true;
      c.weight += weight;
    } else {
      // Diminishing returns for repeated mentions within the same article.
      const n = side === "cause" ? c.fromCauseArticle++ : c.fromEffectArticle++;
      c.weight += weight / (1 + n);
      if (c.ev.filter((x) => x.src === "wikipedia").length >= 3) {
        candidates.set(key, c);
        return;
      }
    }
    c.ev.push(ev);
    candidates.set(key, c);
  };

  const structure: StructLink[] = [];
  const structKeys = new Set<string>();
  const addStruct = (s: string, t: string, rel: StructLink["rel"]) => {
    const key = `${s}|${t}|${rel}`;
    if (s === t || structKeys.has(key) || !entities.has(s) || !entities.has(t)) return;
    structKeys.add(key);
    structure.push({ s, t, rel });
  };

  for (const r of relations) {
    const cp = CAUSAL_PROPS[r.p];
    if (cp) {
      const [s, t] = cp.dir === "cause_of_a" ? [r.b, r.a] : [r.a, r.b];
      add(s, t, cp.weight, { src: "wikidata", prop: cp.name });
      continue;
    }
    if (r.p === "P361") addStruct(r.a, r.b, "part_of");
    else if (r.p === "P710") addStruct(r.b, r.a, "participant");
    else if (r.p === "P1344" || r.p === "P607") addStruct(r.a, r.b, "participant");
    else if (r.p === "P1366") addStruct(r.a, r.b, "succeeded_by");
    else if (r.p === "P1365") addStruct(r.b, r.a, "succeeded_by");
    else if (r.p === "P156") addStruct(r.a, r.b, "followed_by");
    else if (r.p === "P155") addStruct(r.b, r.a, "followed_by");
  }

  for (const e of kept) {
    const article = e.article ? articleOf.get(e.article) : undefined;
    if (!article || !entities.has(e.id)) continue;
    for (const l of article.links) {
      const other = byTitle.get(l.target);
      if (!other || other === e.id) continue;
      const ev: Evidence = { src: "wikipedia", article: e.article!, section: l.heading, text: l.sentence };
      if (l.kind === "before") add(other, e.id, 1, ev, "effect");
      else add(e.id, other, 1, ev, "cause");
    }
  }

  // Score, then keep each entity's strongest causes and effects.
  const scored = [...candidates.values()].map((c) => {
    const cause = entities.get(c.s)!;
    const effect = entities.get(c.t)!;
    const corroborated = (c.fromCauseArticle > 0 && c.fromEffectArticle > 0) || (c.wikidata && c.fromCauseArticle + c.fromEffectArticle > 0);
    const score = (c.weight + (corroborated ? 1.5 : 0)) * kindFactor(cause, effect) * significance(cause, effect);
    return { ...c, score: Math.round(score * 100) / 100 };
  });
  const topBy = (key: "s" | "t", max: number) => {
    const groups = new Map<string, typeof scored>();
    for (const c of scored) groups.set(c[key], [...(groups.get(c[key]) ?? []), c]);
    const keep = new Set<string>();
    for (const list of groups.values()) {
      list.sort((a, b) => b.score - a.score);
      for (const c of list.slice(0, max)) keep.add(`${c.s}>${c.t}`);
    }
    return keep;
  };
  const asCause = topBy("s", MAX_EFFECTS);
  const asEffect = topBy("t", MAX_CAUSES);
  const links: CausalLink[] = scored
    .filter((c) => c.score >= MIN_SCORE && (asCause.has(`${c.s}>${c.t}`) || asEffect.has(`${c.s}>${c.t}`)))
    .sort((a, b) => b.score - a.score)
    .map(({ s, t, score, ev }) => ({ s, t, score, ev }));

  log(`causal candidates: ${candidates.size} → kept ${links.length}; structural: ${structure.length}`);
  const sorted = [...entities.values()].sort((a, b) => b.sig - a.sig);
  await writeJSONLines("entities.json", sorted);
  await writeJSONLines("links.json", links);
  await writeJSONLines("structure.json", structure);
  await writeJSONLines("lenses.json", LENSES.map(({ id, label }) => ({ id, label })));
}

if (import.meta.main) await main();
