// In-memory index over the curated history database in /data (built by
// /pipeline from Wikidata and Wikipedia). Everything here is deterministic
// and sourced; the LLM is only a fallback for what the database lacks.

import { readFileSync, existsSync } from "node:fs";
import type { Strength } from "./helpers.ts";

export type Entity = {
  id: string;
  title: string;
  kind: string;
  lenses: string[];
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
  | { src: "wikipedia"; article: string; section: string; text: string }
  | { src: "curated" };

export type Curated = { strength: Strength; mechanism: string };

export type Review = { verdict: "keep" | "reject" | "reverse"; strength: Strength; mechanism: string };

export type CausalLink = { s: string; t: string; score: number; ev: Evidence[]; review?: Review };
type StructLink = { s: string; t: string; rel: "part_of" | "participant" | "succeeded_by" | "followed_by" };

export type Meta = { lenses: { id: string; label: string; count: number }[]; regions: { id: string; count: number }[]; total: number; links: number };

export type LinkView = {
  id: string;
  source: string;
  target: string;
  strength: Strength;
  reasoning: string;
  score: number;
  evidence: Evidence[];
  reviewed: boolean;
};

export type EntitySummary = Pick<Entity, "id" | "title" | "kind" | "sig" | "start" | "end" | "region" | "country" | "desc" | "img"> & {
  nCauses: number;
  nEffects: number;
};

const DATA_DIR = new URL("../../data/", import.meta.url);

function readJSON<T>(name: string, fallback: T): T {
  const url = new URL(name, DATA_DIR);
  return existsSync(url) ? (JSON.parse(readFileSync(url, "utf8")) as T) : fallback;
}

export function strengthOf(link: CausalLink): Strength {
  if (link.review) return link.review.strength;
  if (link.score >= 4) return "primary";
  if (link.score >= 1.8) return "contributing";
  return "minor";
}

function bestSentence(link: CausalLink): string {
  const wiki = link.ev.find((e): e is Extract<Evidence, { src: "wikipedia" }> => e.src === "wikipedia");
  return wiki?.text ?? "";
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export class Atlas {
  readonly entities = new Map<string, Entity>();
  private causes = new Map<string, CausalLink[]>();
  private effects = new Map<string, CausalLink[]>();
  private struct: StructLink[] = [];
  private folded: { id: string; title: string; sig: number }[] = [];
  readonly meta: Meta;

  constructor(
    entities: Entity[],
    links: CausalLink[],
    structure: StructLink[],
    reviews: Record<string, Review> = {},
    // Unreviewed links below this score (single uncorroborated mentions)
    // are mostly noise, so they're withheld until reviewed.
    minUnreviewedScore = 0,
    // Links proposed by gap-filling agents from vetted shortlists; they have
    // no source passage and are labeled as such.
    curated: Record<string, Curated> = {}
  ) {
    for (const e of entities) this.entities.set(e.id, e);
    const seen = new Set<string>();
    const accept = (raw: CausalLink) => {
      const review = raw.review ?? reviews[`${raw.s}>${raw.t}`];
      if (review?.verdict === "reject") return;
      if (!review && raw.score < minUnreviewedScore) return;
      const link = review?.verdict === "reverse" ? { ...raw, s: raw.t, t: raw.s, review } : { ...raw, review };
      if (!this.entities.has(link.s) || !this.entities.has(link.t)) return;
      // A reversed candidate can coincide with the opposite candidate; keep one.
      const pair = `${link.s}>${link.t}`;
      if (seen.has(pair)) return;
      seen.add(pair);
      this.push(this.causes, link.t, link);
      this.push(this.effects, link.s, link);
    };
    for (const raw of links) accept(raw);
    // Curated links fill pairs that no accepted sourced link covers (a
    // rejected or withheld candidate doesn't block them).
    for (const [key, c] of Object.entries(curated)) {
      if (seen.has(key)) continue;
      const [s, t] = key.split(">") as [string, string];
      accept({ s, t, score: 2, ev: [{ src: "curated" }], review: { verdict: "keep", ...c } });
    }
    for (const list of [...this.causes.values(), ...this.effects.values()]) list.sort((a, b) => rank(b) - rank(a));
    this.struct = structure.filter((l) => this.entities.has(l.s) && this.entities.has(l.t));
    this.folded = entities.map((e) => ({ id: e.id, title: fold(e.title), sig: e.sig }));
    this.meta = this.computeMeta([...this.effects.values()].reduce((n, l) => n + l.length, 0));
  }

  static load(): Atlas {
    return new Atlas(
      readJSON<Entity[]>("entities.json", []),
      readJSON<CausalLink[]>("links.json", []),
      readJSON<StructLink[]>("structure.json", []),
      readJSON<Record<string, Review>>("reviews.json", {}),
      1.8,
      readJSON<Record<string, Curated>>("curated.json", {})
    );
  }

  private push(map: Map<string, CausalLink[]>, key: string, link: CausalLink) {
    const list = map.get(key);
    if (list) list.push(link);
    else map.set(key, [link]);
  }

  private computeMeta(linkCount: number): Meta {
    const lensLabels = readJSON<{ id: string; label: string }[]>("lenses.json", []);
    const lensCount = new Map<string, number>();
    const regionCount = new Map<string, number>();
    for (const e of this.entities.values()) {
      lensCount.set(e.kind, (lensCount.get(e.kind) ?? 0) + 1);
      regionCount.set(e.region, (regionCount.get(e.region) ?? 0) + 1);
    }
    return {
      lenses: lensLabels.map((l) => ({ ...l, count: lensCount.get(l.id) ?? 0 })),
      regions: [...regionCount].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
      total: this.entities.size,
      links: linkCount,
    };
  }

  summary(e: Entity): EntitySummary {
    const { id, title, kind, sig, start, end, region, country, desc, img } = e;
    return {
      id, title, kind, sig, start, end, region, country, desc, img,
      nCauses: Math.min(12, this.causes.get(id)?.length ?? 0),
      nEffects: Math.min(12, this.effects.get(id)?.length ?? 0),
    };
  }

  view(link: CausalLink): LinkView {
    return {
      id: `${link.s}>${link.t}`,
      source: link.s,
      target: link.t,
      strength: strengthOf(link),
      reasoning: link.review?.mechanism || bestSentence(link),
      score: link.score,
      evidence: link.ev,
      reviewed: !!link.review,
    };
  }

  search(q: string, limit = 8): EntitySummary[] {
    const query = fold(q);
    if (!query) return [];
    const words = query.split(" ");
    const scored: { id: string; score: number }[] = [];
    for (const f of this.folded) {
      let score = 0;
      if (f.title === query) score = 100;
      else if (f.title.startsWith(query)) score = 60;
      else if (f.title.includes(` ${query}`)) score = 45;
      else if (f.title.includes(query)) score = 25;
      else if (words.length > 1 && words.every((w) => f.title.includes(w))) score = 20;
      if (score) scored.push({ id: f.id, score: score + Math.log2(f.sig + 1) * 5 });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => this.summary(this.entities.get(s.id)!));
  }

  browse(opts: { from?: number; to?: number; region?: string; lens?: string; limit?: number }) {
    const from = opts.from ?? -Infinity;
    const to = opts.to ?? Infinity;
    const lensFilter = opts.lens && opts.lens !== "all" ? opts.lens : null;
    const scored: { e: Entity; score: number }[] = [];
    for (const e of this.entities.values()) {
      // Global events (world wars, pandemics) belong in every region's view.
      const regionFilter = opts.region && opts.region !== "all" ? opts.region : null;
      if (regionFilter && e.region !== regionFilter && e.region !== "Global") continue;
      if (lensFilter && !e.lenses.includes(lensFilter)) continue;
      const person = e.kind === "leader" || e.kind === "thinker";
      // People belong to the window of their career, not their whole life.
      const begin = person ? e.start + 20 : e.start;
      const end = person ? (e.end ?? e.start + 70) : (e.end ?? e.start);
      if (end < from || begin >= to) continue;
      const startsHere = person ? e.start + 35 >= from && e.start + 35 < to : e.start >= from;
      const enduring = person || e.kind === "state" || e.kind === "period" || e.kind === "idea";
      // What *happened* in a window outranks what merely existed during it.
      if (!startsHere && enduring && !lensFilter) continue;
      const globalInRegion = regionFilter && e.region === "Global" ? -1.5 : 0;
      scored.push({ e, score: Math.log2(e.sig + 1) + (startsHere ? 3 : 0) + (lensFilter ? 0 : (KIND_WEIGHT[e.kind] ?? 0)) + globalInRegion });
    }
    scored.sort((a, b) => b.score - a.score);
    return { total: scored.length, items: scored.slice(0, opts.limit ?? 40).map((x) => this.summary(x.e)) };
  }

  causesOf(id: string, limit = 12): LinkView[] {
    return (this.causes.get(id) ?? []).slice(0, limit).map((l) => this.view(l));
  }

  effectsOf(id: string, limit = 12): LinkView[] {
    return (this.effects.get(id) ?? []).slice(0, limit).map((l) => this.view(l));
  }

  // All visible links whose two ends are both in `ids`: one call instead of
  // fetching every entity's detail to find connections among them.
  linksAmong(ids: string[]): LinkView[] {
    const set = new Set(ids);
    const out: LinkView[] = [];
    for (const id of set) for (const l of this.effects.get(id) ?? []) if (set.has(l.t)) out.push(this.view(l));
    return out;
  }

  summaries(ids: string[]): EntitySummary[] {
    return ids.map((id) => this.entities.get(id)).filter((e): e is Entity => !!e).map((e) => this.summary(e));
  }

  link(source: string, target: string): LinkView | null {
    const l = (this.effects.get(source) ?? []).find((x) => x.t === target);
    return l ? this.view(l) : null;
  }

  detail(id: string) {
    const e = this.entities.get(id);
    if (!e) return null;
    const rel = (pick: (l: StructLink) => string | null) =>
      [...new Set(this.struct.map(pick))]
        .filter((x): x is string => !!x && x !== id)
        .map((x) => this.entities.get(x)!)
        .sort((a, b) => b.sig - a.sig)
        .slice(0, 12)
        .map((x) => this.summary(x));
    const causes = this.causesOf(id);
    const effects = this.effectsOf(id);
    const neighbors = new Set([...causes.map((l) => l.source), ...effects.map((l) => l.target)]);
    return {
      entity: { ...e, ...this.summary(e) },
      causes,
      effects,
      neighbors: [...neighbors].map((n) => this.summary(this.entities.get(n)!)),
      partOf: rel((l) => (l.rel === "part_of" && l.s === id ? l.t : null)),
      parts: rel((l) => (l.rel === "part_of" && l.t === id ? l.s : null)),
      participants: rel((l) => (l.rel === "participant" && l.t === id ? l.s : null)),
      participatedIn: rel((l) => (l.rel === "participant" && l.s === id ? l.t : null)),
      preceded: rel((l) => ((l.rel === "succeeded_by" || l.rel === "followed_by") && l.t === id ? l.s : null)),
      succeeded: rel((l) => ((l.rel === "succeeded_by" || l.rel === "followed_by") && l.s === id ? l.t : null)),
    };
  }

  // Strongest causal chain from one entity to another, following sourced
  // links forward. Tries solid links first (a chain of well-evidenced steps
  // explains more than a weak direct claim), then allows weak ones.
  path(from: string, to: string, opts: { maxSteps?: number; skipDirect?: boolean } = {}): LinkView[] | null {
    if (!this.entities.has(from) || !this.entities.has(to) || from === to) return null;
    const maxSteps = opts.maxSteps ?? 7;
    const skip = opts.skipDirect ? `${from}>${to}` : null;
    return this.searchPath(from, to, maxSteps, 1.8, skip) ?? this.searchPath(from, to, maxSteps, 0, skip);
  }

  // Exact cheapest path with at most `maxSteps` links: a layered
  // Bellman–Ford over (node, steps), cheap at this graph size, and unlike
  // plain Dijkstra it can't lose a short route behind a cheaper long one.
  private searchPath(from: string, to: string, maxSteps: number, minScore: number, skip: string | null): LinkView[] | null {
    type State = { cost: number; via: CausalLink | null };
    const layers: Map<string, State>[] = [new Map([[from, { cost: 0, via: null }]])];
    for (let k = 1; k <= maxSteps; k++) {
      const next = new Map<string, State>();
      for (const [id, st] of layers[k - 1]!) {
        if (id === to) continue;
        for (const link of this.effects.get(id) ?? []) {
          if (link.score < minScore && !link.review) continue;
          if (skip && `${link.s}>${link.t}` === skip) continue;
          const cost = st.cost + 1 + 2 / (0.5 + link.score);
          if (cost < (next.get(link.t)?.cost ?? Infinity)) next.set(link.t, { cost, via: link });
        }
      }
      if (next.size === 0) break;
      layers.push(next);
    }
    let bestK = -1;
    for (let k = 1; k < layers.length; k++) {
      const c = layers[k]!.get(to)?.cost;
      if (c !== undefined && (bestK < 0 || c < layers[bestK]!.get(to)!.cost)) bestK = k;
    }
    if (bestK < 0) return null;
    const chain: CausalLink[] = [];
    let cur = to;
    for (let k = bestK; k > 0; k--) {
      const link = layers[k]!.get(cur)!.via!;
      chain.unshift(link);
      cur = link.s;
    }
    return chain.map((l) => this.view(l));
  }

}

// In mixed views, what happened leads; people and discoveries follow.
const KIND_WEIGHT: Record<string, number> = {
  war: 2,
  revolution: 2,
  event: 2,
  treaty: 1.5,
  disaster: 1.5,
  atrocity: 1,
  battle: 1,
  state: 1,
  period: 1,
  idea: 1,
  invention: -1,
  leader: -2,
  thinker: -2,
};

function rank(l: CausalLink): number {
  const strengthBonus = l.review ? { primary: 3, contributing: 1, minor: 0 }[l.review.strength] : 0;
  return l.score + strengthBonus;
}
