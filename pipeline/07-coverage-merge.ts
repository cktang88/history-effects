// Step 7c: verify coverage proposals (pipeline/out/coverage/result-NN.json:
// {cell: [Wikipedia titles]}) and record survivors in pipeline/seeds.json.
// A title survives only if it resolves (through redirects) to a Wikidata
// item that isn't a place/organization/person, has enough Wikipedia
// coverage, and starts inside its cell's time window.
//
// Run as: bun run 07-coverage-merge.ts titles   (collect titles for 07b)
//         python3 07b-redirects.py
//         bun run 07-coverage-merge.ts           (verify and write seeds)

import { readdir, readFile, writeFile } from "node:fs/promises";
import { detailsQuery, parseDetails } from "./01-entities.ts";
import { lensFromType, settingIds } from "./01b-expand.ts";
import type { LensId } from "./lenses.ts";
import { chunk, log, qid, sparql } from "./lib.ts";
import { ERAS } from "../web/src/atlas/eras.ts";

export type Seed = { id: string; lens: LensId; title: string; cell: string };

const MIN_SITELINKS = 8;
const dir = new URL("./out/coverage/", import.meta.url);
const seedsFile = new URL("./seeds.json", import.meta.url);

async function proposals(): Promise<{ title: string; cell: string }[]> {
  const out: { title: string; cell: string }[] = [];
  for (const f of (await readdir(dir)).filter((f) => f.startsWith("result-")).sort()) {
    try {
      const parsed = JSON.parse(await readFile(new URL(f, dir), "utf8")) as Record<string, unknown>;
      for (const [cell, titles] of Object.entries(parsed)) {
        if (!Array.isArray(titles)) continue;
        for (const t of titles) if (typeof t === "string" && t.trim()) out.push({ title: normalize(t), cell });
      }
    } catch {
      log(`unreadable ${f}`);
    }
  }
  return out;
}

const normalize = (t: string) => {
  const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function windowOf(cell: string) {
  const id = cell.split("|")[0];
  const era = ERAS.find((e) => e.id === id);
  if (!era) return null;
  const slack = Math.max(3, Math.round((era.to - era.from) * 0.15));
  return { from: era.from - slack, to: era.to + slack };
}

async function main() {
  const props = await proposals();
  if (process.argv[2] === "titles") {
    await writeFile(new URL("titles.json", dir), JSON.stringify([...new Set(props.map((p) => p.title))]));
    log(`${props.length} proposals, ${new Set(props.map((p) => p.title)).size} distinct titles`);
    return;
  }
  const redirects = JSON.parse(await readFile(new URL("redirects.json", dir), "utf8")) as Record<string, string>;
  const canonical = (t: string) => redirects[t] ?? t;

  // Resolve canonical titles to Wikidata items.
  const titles = [...new Set(props.map((p) => canonical(p.title)))];
  const itemOf = new Map<string, string>();
  for (const batch of chunk(titles, 200)) {
    const values = batch.map((t) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`).join(" ");
    const rows = await sparql(`
SELECT ?item ?name WHERE {
  VALUES ?name { ${values} }
  ?article schema:name ?name ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?item .
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }
}`);
    for (const r of rows) itemOf.set(r.name!.value, qid(r.item!.value));
  }

  const ids = [...new Set(itemOf.values())];
  const settings = await settingIds(ids);
  const details = new Map<string, ReturnType<typeof parseDetails>[number]>();
  for (const batch of chunk(ids, 150)) for (const d of parseDetails(await sparql(detailsQuery(batch, true)))) details.set(d.id, d);

  let existing: Seed[] = [];
  try {
    existing = JSON.parse(await readFile(seedsFile, "utf8"));
  } catch {}
  const seeds = new Map(existing.map((s) => [s.id, s]));
  const reasons: Record<string, number> = {};
  const reject = (why: string) => (reasons[why] = (reasons[why] ?? 0) + 1);
  for (const p of props) {
    const id = itemOf.get(canonical(p.title));
    if (!id) {
      reject("no such article");
      continue;
    }
    const d = details.get(id);
    const win = windowOf(p.cell);
    if (!d || !win) reject("no details");
    else if (settings.has(id)) reject("place/organization");
    else if (d.sitelinks < MIN_SITELINKS) reject("too obscure");
    // Accept anything that existed during the cell (a kingdom named for a
    // later century than its founding); it's placed at its own start date.
    else if (d.start === undefined || d.start > win.to || (d.end ?? d.start) < win.from) reject("outside its era");
    else if (!seeds.has(id)) seeds.set(id, { id, lens: lensFromType(d.type, false), title: d.article ?? d.label ?? p.title, cell: p.cell });
  }
  const list = [...seeds.values()].sort((a, b) => a.cell.localeCompare(b.cell) || a.title.localeCompare(b.title));
  await writeFile(seedsFile, "[\n" + list.map((s) => JSON.stringify(s)).join(",\n") + "\n]\n");
  log(`${props.length} proposals → ${list.length - existing.length} new seeds (${list.length} total); rejected ${JSON.stringify(reasons)}`);
}

if (import.meta.main) await main();
