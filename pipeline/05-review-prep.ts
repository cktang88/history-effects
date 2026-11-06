// Step 5a: choose the links most worth an LLM review (both ends significant)
// and write them as batches for reviewer agents.
// Output: pipeline/out/review/batch-NN.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CausalLink, Entity } from "./04-build.ts";
import { chunk, log, readJSON } from "./lib.ts";

const BATCH = Number(process.env.REVIEW_BATCH ?? 150);
const LIMIT = Number(process.env.REVIEW_LIMIT ?? 1200);

const brief = (e: Entity) => ({
  title: e.title,
  kind: e.kind,
  date: e.end && e.end !== e.start ? `${e.start}–${e.end}` : `${e.start}`,
  about: (e.summary || e.desc || "").slice(0, 280),
});

async function main() {
  const entities = new Map((await readJSON<Entity[]>("entities.json")).map((e) => [e.id, e]));
  const links = await readJSON<CausalLink[]>("links.json");
  let reviewed: Record<string, unknown> = {};
  try {
    reviewed = JSON.parse(await readFile(new URL("../data/reviews.json", import.meta.url), "utf8"));
  } catch {}
  const importance = (l: CausalLink) => Math.min(entities.get(l.s)!.sig, entities.get(l.t)!.sig) * (0.5 + Math.min(l.score, 4) / 4);
  const todo = links
    .filter((l) => !(`${l.s}>${l.t}` in reviewed))
    .sort((a, b) => importance(b) - importance(a))
    .slice(0, LIMIT)
    .map((l) => ({
      key: `${l.s}>${l.t}`,
      cause: brief(entities.get(l.s)!),
      effect: brief(entities.get(l.t)!),
      evidence: l.ev.map((ev) => (ev.src === "wikidata" ? `Wikidata: "${ev.prop}"` : `Wikipedia, ${ev.article} › ${ev.section}: "${ev.text}"`)),
    }));
  const dir = new URL("./out/review/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const batches = chunk(todo, BATCH);
  for (const [i, b] of batches.entries()) await writeFile(new URL(`batch-${String(i).padStart(2, "0")}.json`, dir), JSON.stringify(b, null, 1));
  log(`${todo.length} links in ${batches.length} batches`);
}

if (import.meta.main) await main();
