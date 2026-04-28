import type { CausalItem, HistoricalEvent, Strength } from "./types";

type RequestOptions = {
  refresh?: boolean;
};

const API_CACHE_PREFIX = "history-effects:api:";

async function postJSON<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const cacheKey = `${API_CACHE_PREFIX}${path}:${stableStringify(body)}`;
  if (!options.refresh) {
    const cached = readCache<T>(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as T;
  writeCache(cacheKey, json);
  return json;
}

function readCache<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForCache(value));
}

function sortForCache(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortForCache);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, sortForCache(val)])
  );
}

export function seedEvent(text: string, options?: RequestOptions) {
  return postJSON<{ event: HistoricalEvent }>("/api/seed", { text }, options);
}

export function enrichEvent(event: HistoricalEvent, options?: RequestOptions) {
  return postJSON<{ event: HistoricalEvent }>("/api/enrich", { event }, options);
}

export function generateEffects(event: HistoricalEvent, n = 5, options?: RequestOptions) {
  return postJSON<{ effects: CausalItem[] }>("/api/effects", { event, n }, options);
}

export function generateCauses(event: HistoricalEvent, n = 5, options?: RequestOptions) {
  return postJSON<{ causes: CausalItem[] }>("/api/causes", { event, n }, options);
}

export function generateBridge(from: HistoricalEvent, to: HistoricalEvent, options?: RequestOptions) {
  return postJSON<{
    intermediate: HistoricalEvent | null;
    fromStrength: Strength;
    toStrength: Strength;
    reasoning: string;
  }>("/api/bridge", { from, to }, options);
}
