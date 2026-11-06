import type { CausalItem, Explanation, HistoricalEvent, PathResult } from "./types";

export type StreamHandlers = {
  // Called once per object as soon as the model finishes writing it.
  onItem?: (key: string, value: unknown, index: number) => void;
  onThinking?: (text: string) => void;
  signal?: AbortSignal;
  refresh?: boolean;
};

export type ExpandContext = {
  path?: string[];
  existing?: string[];
  exclude?: string[];
};

const API_CACHE_PREFIX = "history-effects:api:v2:";

type CachedStream<T> = { items: { key: string; value: unknown; index: number }[]; result: T };

export async function postStream<T>(path: string, body: unknown, handlers: StreamHandlers = {}): Promise<T> {
  const cacheKey = `${API_CACHE_PREFIX}${path}:${stableStringify(body)}`;
  const cached = handlers.refresh ? null : readCache<CachedStream<T>>(cacheKey);
  if (cached) {
    for (const item of cached.items) handlers.onItem?.(item.key, item.value, item.index);
    return cached.result;
  }

  const res = await fetch(`${path}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  if (!res.body) throw new Error("The server returned an empty response.");

  const items: CachedStream<T>["items"] = [];
  const result = await readSSE<T>(res.body, {
    ...handlers,
    onItem: (key, value, index) => {
      items.push({ key, value, index });
      handlers.onItem?.(key, value, index);
    },
  });
  writeCache(cacheKey, { items, result });
  return result;
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {}
  if (res.status === 502 || res.status === 504 || res.status === 500) {
    return text || "The history server isn't reachable. Is it running on port 3000?";
  }
  return `${res.status} ${text}`;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: caching is best-effort.
  }
}

export function stableStringify(value: unknown): string {
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

export async function readSSE<T>(body: ReadableStream<Uint8Array>, handlers: StreamHandlers = {}): Promise<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let error: string | undefined;

  const handle = (raw: string) => {
    const parsed = parseSSEEvent(raw);
    if (!parsed) return;
    const data = JSON.parse(parsed.data) as Record<string, unknown>;
    if (parsed.event === "item") handlers.onItem?.(String(data.key), data.value, Number(data.index ?? 0));
    else if (parsed.event === "thinking" && typeof data.text === "string") handlers.onThinking?.(data.text);
    else if (parsed.event === "result") result = data as T;
    else if (parsed.event === "error") error = typeof data.error === "string" ? data.error : "stream failed";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    events.forEach(handle);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);

  if (error) throw new Error(error);
  if (result === undefined) throw new Error("The response ended early. Try again.");
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

export const explore = (text: string, h?: StreamHandlers) =>
  postStream<{ event: HistoricalEvent; effects: CausalItem[]; causes: CausalItem[] }>("/api/explore", { text, n: 5 }, h);

export const expand = (
  direction: "effects" | "causes",
  event: HistoricalEvent,
  n: number,
  context: ExpandContext,
  h?: StreamHandlers
) => postStream<Record<string, CausalItem[]>>(`/api/${direction}`, { event, n, context }, h);

export const tracePath = (from: HistoricalEvent | string, to: HistoricalEvent | string, h?: StreamHandlers) =>
  postStream<PathResult>("/api/path", { from, to }, h);

export const explain = (cause: HistoricalEvent, effect: HistoricalEvent, reasoning: string, h?: StreamHandlers) =>
  postStream<Explanation>("/api/explain", { cause, effect, reasoning }, h);

export const enrich = (event: HistoricalEvent, h?: StreamHandlers) =>
  postStream<{ event: HistoricalEvent }>("/api/enrich", { event }, h);
