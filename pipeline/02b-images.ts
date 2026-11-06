// Step 2b: a representative image (Wikidata P18) per entity. Only the
// Commons filename is stored; the browser loads a sized thumbnail from
// Wikimedia Commons directly.
// Output: pipeline/out/images.json ({QID: filename})

import type { RawEntity } from "./01-entities.ts";
import { chunk, log, qid, readPipeline, sparql, writePipeline } from "./lib.ts";

async function main() {
  const entities = await readPipeline<RawEntity[]>("entities.raw.json");
  const images: Record<string, string> = {};
  for (const batch of chunk(entities.map((e) => e.id).sort(), 300)) {
    const rows = await sparql(`
SELECT ?item (SAMPLE(?img) AS ?image) WHERE {
  VALUES ?item { ${batch.map((i) => `wd:${i}`).join(" ")} }
  ?item wdt:P18 ?img .
} GROUP BY ?item`);
    for (const r of rows) {
      const url = r.image?.value;
      if (url) images[qid(r.item!.value)] = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
    }
  }
  await writePipeline("images.json", images);
  log(`images for ${Object.keys(images).length} of ${entities.length} entities`);
}

if (import.meta.main) await main();
