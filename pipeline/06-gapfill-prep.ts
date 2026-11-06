// Step 6a: find significant entities whose sourced causes/effects are thin
// after review, and give each a shortlist of plausible database entities
// (right time window, significant, preferably same region). Agents may only
// choose from the shortlist, so every proposed link joins two curated nodes.
// Output: pipeline/out/gapfill/batch-NN.json

import { mkdir, writeFile } from "node:fs/promises";
import type { CausalLink, Entity } from "./04-build.ts";
import { chunk, log, readJSON } from "./lib.ts";

type Review = { verdict: string };

const TARGETS = Number(process.env.GAPFILL_TARGETS ?? 480);
const BATCH = Number(process.env.GAPFILL_BATCH ?? 60);
const SHORTLIST = 45;
const PEOPLE = new Set(["leader", "thinker"]);

const when = (e: Entity) => (PEOPLE.has(e.kind) ? e.start + 35 : e.start);
const label = (e: Entity) => `${e.id} | ${e.title} | ${e.kind} | ${e.end && e.end !== e.start ? `${e.start}–${e.end}` : e.start} | ${e.region}`;

async function main() {
  const entities = await readJSON<Entity[]>("entities.json");
  const byId = new Map(entities.map((e) => [e.id, e]));
  const links = await readJSON<CausalLink[]>("links.json");
  const reviews = await readJSON<Record<string, Review>>("reviews.json");
  let curated: Record<string, unknown> = {};
  try {
    curated = await readJSON<Record<string, unknown>>("curated.json");
  } catch {}
  const curatedPairs = Object.keys(curated).map((k) => k.split(">") as [string, string]);

  // Count what the app will actually show per entity.
  const causes = new Map<string, number>();
  const effects = new Map<string, number>();
  for (const l of links) {
    const r = reviews[`${l.s}>${l.t}`];
    if (r?.verdict === "reject" || (!r && l.score < 1.8)) continue;
    const [s, t] = r?.verdict === "reverse" ? [l.t, l.s] : [l.s, l.t];
    effects.set(s, (effects.get(s) ?? 0) + 1);
    causes.set(t, (causes.get(t) ?? 0) + 1);
  }
  for (const [s, t] of curatedPairs) {
    effects.set(s, (effects.get(s) ?? 0) + 1);
    causes.set(t, (causes.get(t) ?? 0) + 1);
  }

  const eventKinds = new Set(["war", "battle", "revolution", "treaty", "disaster", "atrocity", "event", "period", "invention", "idea", "state"]);
  const targets = entities
    // Still-existing states (no end date) are context, not lessons in causation.
    .filter((e) => eventKinds.has(e.kind) && !(e.kind === "state" && e.end === undefined) && e.start > -3500)
    .filter((e) => (causes.get(e.id) ?? 0) < 3 || (effects.get(e.id) ?? 0) < 3)
    .sort((a, b) => b.sig - a.sig)
    .slice(0, TARGETS);

  // Mostly events, a few people; nearer in time and same region rank higher.
  const shortlist = (e: Entity, dir: "causes" | "effects") => {
    const t = when(e);
    const span = Math.abs(t) > 1500 ? 150 : 400;
    const ranked = entities
      .filter((c) => c.id !== e.id && (dir === "effects" ? !PEOPLE.has(c.kind) : true))
      .filter((c) => (dir === "causes" ? when(c) <= t + 1 && when(c) >= t - span : when(c) >= t && when(c) <= t + span))
      .map((c) => ({
        c,
        score:
          Math.log2(c.sig + 1) +
          (c.region === e.region ? 2 : c.region === "Global" ? 1 : 0) -
          1.5 * Math.log10(1 + Math.abs(when(c) - t) / 5),
      }))
      .sort((a, b) => b.score - a.score);
    const people = ranked.filter((x) => PEOPLE.has(x.c.kind)).slice(0, 8);
    const events = ranked.filter((x) => !PEOPLE.has(x.c.kind)).slice(0, SHORTLIST - people.length);
    return [...events, ...people].map((x) => label(x.c));
  };

  const items = targets.map((e) => ({
    id: e.id,
    entity: label(e),
    about: (e.summary || e.desc || "").slice(0, 300),
    alreadyLinked: links
      .filter((l) => (l.s === e.id || l.t === e.id) && reviews[`${l.s}>${l.t}`]?.verdict !== "reject")
      .map((l) => `${byId.get(l.s)?.title} → ${byId.get(l.t)?.title}`)
      .concat(curatedPairs.filter(([a, b]) => a === e.id || b === e.id).map(([a, b]) => `${byId.get(a)?.title} → ${byId.get(b)?.title}`)),
    causeCandidates: (causes.get(e.id) ?? 0) < 3 ? shortlist(e, "causes") : [],
    effectCandidates: (effects.get(e.id) ?? 0) < 3 ? shortlist(e, "effects") : [],
  }));

  const dir = new URL("./out/gapfill/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const batches = chunk(items, BATCH);
  for (const [i, b] of batches.entries()) await writeFile(new URL(`batch-${String(i).padStart(2, "0")}.json`, dir), JSON.stringify(b, null, 1));
  log(`${items.length} thin entities in ${batches.length} batches`);
}

if (import.meta.main) await main();
