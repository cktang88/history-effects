// Step 6b: validate gap-fill proposals (pipeline/out/gapfill/result-NN.json)
// and merge them into data/curated.json. A proposal is accepted only if both
// ends are database entities, the cause comes first, and the target asked
// for that direction. These links carry no source passage and are labeled
// as curated by AI review in the app.

import { readdir, readFile, writeFile } from "node:fs/promises";
import type { Entity } from "./04-build.ts";
import { log, readJSON } from "./lib.ts";

export type Curated = { strength: "primary" | "contributing" | "minor"; mechanism: string };
type Proposal = { cause: string; effect: string; strength: string; mechanism: string };

const STRENGTHS = new Set(["primary", "contributing", "minor"]);
const PEOPLE = new Set(["leader", "thinker"]);

async function main() {
  const entities = new Map((await readJSON<Entity[]>("entities.json")).map((e) => [e.id, e]));
  const dir = new URL("./out/gapfill/", import.meta.url);
  const target = new URL("../data/curated.json", import.meta.url);
  let curated: Record<string, Curated> = {};
  try {
    curated = JSON.parse(await readFile(target, "utf8"));
  } catch {}
  const before = Object.keys(curated).length;
  let rejected = 0;
  for (const f of (await readdir(dir)).filter((f) => f.startsWith("result-")).sort()) {
    let proposals: Proposal[];
    try {
      const parsed = JSON.parse(await readFile(new URL(f, dir), "utf8"));
      proposals = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
    } catch {
      log(`unreadable ${f}`);
      continue;
    }
    for (const p of proposals) {
      const s = entities.get(p?.cause);
      const t = entities.get(p?.effect);
      const mechanism = typeof p?.mechanism === "string" ? p.mechanism.trim().slice(0, 400) : "";
      const startOf = (e: Entity) => (PEOPLE.has(e.kind) ? e.start + 20 : e.start);
      if (!s || !t || s.id === t.id || !mechanism || PEOPLE.has(t.kind) || startOf(s) > t.start + 2) {
        rejected++;
        continue;
      }
      curated[`${s.id}>${t.id}`] = { strength: STRENGTHS.has(p.strength) ? (p.strength as Curated["strength"]) : "contributing", mechanism };
    }
  }
  const sorted = Object.entries(curated).sort(([a], [b]) => a.localeCompare(b));
  await writeFile(target, "{\n" + sorted.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n");
  log(`curated links: ${before} → ${sorted.length}; ${rejected} invalid proposals dropped`);
}

if (import.meta.main) await main();
