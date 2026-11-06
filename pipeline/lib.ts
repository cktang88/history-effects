// Shared helpers for the data pipeline: polite, cached HTTP access to
// Wikidata and Wikipedia, plus small parsing utilities.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

export const USER_AGENT = "history-effects-pipeline/0.1 (https://github.com/cktang88/history-effects)";
const CACHE_DIR = new URL("./.cache/", import.meta.url);
export const DATA_DIR = new URL("../data/", import.meta.url);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;
const MIN_GAP_MS = 400;

async function politeFetch(url: string, init: RequestInit = {}): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers } });
    } catch {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    if (res.ok && text.length > 0) return text;
    if (res.status === 429 || res.status >= 500 || text.length === 0) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${res.status} ${url.slice(0, 160)}\n${text.slice(0, 300)}`);
  }
  throw new Error(`gave up after retries: ${url.slice(0, 160)}`);
}

async function cached(key: string, produce: () => Promise<string>): Promise<string> {
  const file = new URL(createHash("sha1").update(key).digest("hex") + ".txt", CACHE_DIR);
  try {
    return await readFile(file, "utf8");
  } catch {}
  const text = await produce();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, text);
  return text;
}

export type Binding = Record<string, { value: string; type: string }>;

export async function sparql(query: string): Promise<Binding[]> {
  const body = new URLSearchParams({ query }).toString();
  const text = await cached(`sparql:${query}`, () =>
    politeFetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
  );
  return (JSON.parse(text) as { results: { bindings: Binding[] } }).results.bindings;
}

export async function wikiApi(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params }).toString();
  const url = `https://en.wikipedia.org/w/api.php?${qs}`;
  return JSON.parse(await cached(`wiki:${qs}`, () => politeFetch(url)));
}

export const qid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

// Wikidata times look like "-0043-03-15T00:00:00Z" (negative = BCE).
export function yearOf(time: string | undefined): number | undefined {
  if (!time) return undefined;
  const m = time.match(/^([+-]?)(\d{1,6})-/);
  if (!m) return undefined;
  const y = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return Number.isFinite(y) ? y : undefined;
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function readJSON<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, DATA_DIR), "utf8")) as T;
}

// One record per line: diffs stay readable and the file stays greppable.
export async function writeJSONLines(name: string, rows: unknown[]) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL(name, DATA_DIR), "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
}

export async function readPipeline<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(`./out/${name}`, import.meta.url), "utf8")) as T;
}

export async function writePipeline(name: string, value: unknown) {
  const dir = new URL("./out/", import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(name, dir), JSON.stringify(value));
}

export function log(...args: unknown[]) {
  process.stderr.write(args.map(String).join(" ") + "\n");
}

// The extracted Wikipedia evidence is large, so it's stored gzipped (and
// committed, so rebuilds don't need the dump).
export async function readWiki<T>(): Promise<T> {
  return JSON.parse(gunzipSync(await readFile(new URL("./out/wiki.json.gz", import.meta.url))).toString("utf8")) as T;
}

export async function writeWiki(value: unknown) {
  await mkdir(new URL("./out/", import.meta.url), { recursive: true });
  await writeFile(new URL("./out/wiki.json.gz", import.meta.url), gzipSync(JSON.stringify(value), { level: 9 }));
}

// Per-entity cache for batched lookups: results are stored per id, so adding
// entities only queries the new ones (batch-keyed caching would re-query
// everything whenever batch boundaries shift).
export async function cachedPerId<T>(
  name: string,
  ids: string[],
  batchSize: number,
  fetchBatch: (batch: string[]) => Promise<Map<string, T>>
): Promise<Map<string, T | null>> {
  const file = new URL(`per-id-${name}.json`, CACHE_DIR);
  let cache: Record<string, T | null> = {};
  try {
    cache = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  const missing = [...new Set(ids)].filter((id) => !(id in cache));
  for (const [i, batch] of chunk(missing, batchSize).entries()) {
    const found = await fetchBatch(batch);
    // Ids with no result are cached as null so they aren't re-queried.
    for (const id of batch) cache[id] = found.get(id) ?? null;
    if (i % 5 === 4) await persist();
  }
  async function persist() {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(cache));
  }
  if (missing.length) await persist();
  log(`${name}: ${ids.length - missing.length} cached, ${missing.length} fetched`);
  return new Map(ids.map((id) => [id, cache[id] ?? null]));
}
