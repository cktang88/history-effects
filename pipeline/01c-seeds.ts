// Step 1c: add the committed seed list (pipeline/seeds.json, from the
// era × region coverage pass) to the entity set.
// Output: rewrites pipeline/out/entities.raw.json

import { readFile } from "node:fs/promises";
import type { RawEntity } from "./01-entities.ts";
import { detailsQuery, parseDetails } from "./01-entities.ts";
import type { Seed } from "./07-coverage-merge.ts";
import { lensFromType } from "./01b-expand.ts";
import { chunk, log, readPipeline, sparql, writePipeline } from "./lib.ts";

async function main() {
  const entities = await readPipeline<RawEntity[]>("entities.raw.json");
  const seeds = JSON.parse(await readFile(new URL("./seeds.json", import.meta.url), "utf8")) as Seed[];
  const have = new Set(entities.map((e) => e.id));
  const todo = seeds.filter((s) => !have.has(s.id));
  const added: RawEntity[] = [];
  for (const batch of chunk(todo.map((s) => s.id), 150)) {
    // Derive the lens from the current type mapping so it stays consistent.
    for (const d of parseDetails(await sparql(detailsQuery(batch, true)))) added.push({ ...d, lenses: [lensFromType(d.type, false)] });
  }
  await writePipeline("entities.raw.json", [...entities, ...added]);
  log(`seeds: ${seeds.length} listed, ${added.length} added`);
}

if (import.meta.main) await main();
