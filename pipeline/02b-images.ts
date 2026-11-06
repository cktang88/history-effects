// Step 2b: a representative image (Wikidata P18) per entity. Only the
// Commons filename is stored; the browser loads a sized thumbnail from
// Wikimedia Commons directly.
// Output: pipeline/out/images.json ({QID: filename})

import type { RawEntity } from "./01-entities.ts";
import { cachedPerId, log, qid, readPipeline, sparql, writePipeline } from "./lib.ts";

async function main() {
  const entities = await readPipeline<RawEntity[]>("entities.raw.json");
  const found = await cachedPerId("images", entities.map((e) => e.id), 300, async (batch) => {
    const out = new Map<string, string>();
    const rows = await sparql(`
SELECT ?item (SAMPLE(?img) AS ?image) WHERE {
  VALUES ?item { ${batch.map((i) => `wd:${i}`).join(" ")} }
  ?item wdt:P18 ?img .
} GROUP BY ?item`);
    for (const r of rows) {
      const url = r.image?.value;
      if (url) out.set(qid(r.item!.value), decodeURIComponent(url.slice(url.lastIndexOf("/") + 1)));
    }
    return out;
  });
  const images: Record<string, string> = {};
  for (const [id, file] of found) if (file) images[id] = file;
  await writePipeline("images.json", images);
  log(`images for ${Object.keys(images).length} of ${entities.length} entities`);
}

if (import.meta.main) await main();
