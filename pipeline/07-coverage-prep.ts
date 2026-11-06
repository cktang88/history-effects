// Step 7a: coverage by era × region. Global significance rankings favor
// European history, so each region × era cell is checked on its own: what
// the database already has, so reviewer agents can name what's missing.
// Output: pipeline/out/coverage/region-NN.json (one per region)

import { mkdir, writeFile } from "node:fs/promises";
import type { Entity } from "./04-build.ts";
import { ERAS } from "../web/src/atlas/eras.ts";
import { REGIONS } from "./regions.ts";
import { log, readJSON } from "./lib.ts";

const PEOPLE = new Set(["leader", "thinker"]);

export function cellsFor(entities: Entity[], region: string) {
  const inRegion = entities.filter((e) => e.region === region && !PEOPLE.has(e.kind));
  return ERAS.map((era) => {
    const here = inRegion.filter((e) => e.start >= era.from && e.start < era.to).sort((a, b) => b.sig - a.sig);
    return {
      cell: `${era.id}|${region}`,
      era: era.label,
      from: era.from,
      to: era.to,
      have: here.slice(0, 25).map((e) => e.title),
      count: here.length,
    };
  });
}

async function main() {
  const entities = await readJSON<Entity[]>("entities.json");
  const dir = new URL("./out/coverage/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const regions = REGIONS.filter((r) => r !== "Global");
  for (const [i, region] of regions.entries()) {
    const cells = cellsFor(entities, region);
    await writeFile(new URL(`region-${String(i).padStart(2, "0")}.json`, dir), JSON.stringify({ region, cells }, null, 1));
    log(`${region}: ${cells.filter((c) => c.count < 5).length}/${cells.length} thin cells`);
  }
}

if (import.meta.main) await main();
