// Step 5b: validate reviewer output (pipeline/out/review/result-NN.json) and
// merge it into data/reviews.json, which the server applies on load.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { log } from "./lib.ts";

type Review = { verdict: "keep" | "reject" | "reverse"; strength: "primary" | "contributing" | "minor"; mechanism: string };

const VERDICTS = new Set(["keep", "reject", "reverse"]);
const STRENGTHS = new Set(["primary", "contributing", "minor"]);

export function validReview(x: unknown): Review | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!VERDICTS.has(r.verdict as string)) return null;
  const strength = STRENGTHS.has(r.strength as string) ? (r.strength as Review["strength"]) : "contributing";
  const mechanism = typeof r.mechanism === "string" ? r.mechanism.trim().slice(0, 400) : "";
  if (r.verdict !== "reject" && !mechanism) return null;
  return { verdict: r.verdict as Review["verdict"], strength, mechanism };
}

async function main() {
  const dir = new URL("./out/review/", import.meta.url);
  const target = new URL("../data/reviews.json", import.meta.url);
  let merged: Record<string, Review> = {};
  try {
    merged = JSON.parse(await readFile(target, "utf8"));
  } catch {}
  const before = Object.keys(merged).length;
  let bad = 0;
  for (const f of (await readdir(dir)).filter((f) => f.startsWith("result-")).sort()) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await readFile(new URL(f, dir), "utf8"));
    } catch {
      log(`unreadable ${f}`);
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      const r = validReview(value);
      if (r && /^Q\d+>Q\d+$/.test(key)) merged[key] = r;
      else bad++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(target, "{\n" + Object.entries(sorted).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n}\n");
  const counts = Object.values(merged).reduce<Record<string, number>>((c, r) => ((c[r.verdict] = (c[r.verdict] ?? 0) + 1), c), {});
  log(`reviews: ${before} → ${Object.keys(merged).length} (${JSON.stringify(counts)}), ${bad} invalid entries skipped`);
}

if (import.meta.main) await main();
