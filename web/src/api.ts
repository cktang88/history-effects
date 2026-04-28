import type { CausalItem, HistoricalEvent, Strength } from "./types";

type RequestOptions = {
  refresh?: boolean;
  onToken?: (token: string) => void;
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

async function postSSE<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const cacheKey = `${API_CACHE_PREFIX}${path}:${stableStringify(body)}`;
  if (!options.refresh) {
    const cached = readCache<T>(cacheKey);
    if (cached) return cached;
  }

  const res = await fetch(`${path}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}/stream failed: ${res.status} ${text}`);
  }
  if (!res.body) throw new Error(`${path}/stream returned no response body`);

  const result = await readSSE<T>(res.body, options.onToken);
  writeCache(cacheKey, result);
  return result;
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

async function readSSE<T>(body: ReadableStream<Uint8Array>, onToken?: (token: string) => void): Promise<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let error: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const parsed = parseSSEEvent(event);
      if (!parsed) continue;
      if (parsed.event === "token") {
        const data = JSON.parse(parsed.data) as { token?: string };
        if (data.token) onToken?.(data.token);
      } else if (parsed.event === "result") {
        result = JSON.parse(parsed.data) as T;
      } else if (parsed.event === "error") {
        const data = JSON.parse(parsed.data) as { error?: string };
        error = data.error ?? "stream failed";
      }
    }
  }

  buffer += decoder.decode();
  const parsed = parseSSEEvent(buffer);
  if (parsed?.event === "result") result = JSON.parse(parsed.data) as T;
  if (parsed?.event === "error") {
    const data = JSON.parse(parsed.data) as { error?: string };
    error = data.error ?? "stream failed";
  }

  if (error) throw new Error(error);
  if (result === undefined) throw new Error("stream ended without a result");
  return result;
}

function parseSSEEvent(raw: string): { event: string; data: string } | null {
  const lines = raw.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
  return event && data ? { event, data } : null;
}

export function seedEvent(text: string, options?: RequestOptions) {
  const body = { text };
  return options?.onToken ? postSSE<{ event: HistoricalEvent }>("/api/seed", body, options) : postJSON<{ event: HistoricalEvent }>("/api/seed", body, options);
}

export function enrichEvent(event: HistoricalEvent, options?: RequestOptions) {
  const body = { event };
  return options?.onToken ? postSSE<{ event: HistoricalEvent }>("/api/enrich", body, options) : postJSON<{ event: HistoricalEvent }>("/api/enrich", body, options);
}

export function generateEffects(event: HistoricalEvent, n = 5, options?: RequestOptions) {
  const body = { event, n };
  return options?.onToken ? postSSE<{ effects: CausalItem[] }>("/api/effects", body, options) : postJSON<{ effects: CausalItem[] }>("/api/effects", body, options);
}

export function generateCauses(event: HistoricalEvent, n = 5, options?: RequestOptions) {
  const body = { event, n };
  return options?.onToken ? postSSE<{ causes: CausalItem[] }>("/api/causes", body, options) : postJSON<{ causes: CausalItem[] }>("/api/causes", body, options);
}

export function generateBridge(from: HistoricalEvent, to: HistoricalEvent, options?: RequestOptions) {
  type BridgeResponse = {
    intermediate: HistoricalEvent | null;
    fromStrength: Strength;
    toStrength: Strength;
    reasoning: string;
  };
  const body = { from, to };
  return options?.onToken ? postSSE<BridgeResponse>("/api/bridge", body, options) : postJSON<BridgeResponse>("/api/bridge", body, options);
}
