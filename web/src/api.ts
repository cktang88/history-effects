import type { CausalItem, HistoricalEvent, Strength } from "./types";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function seedEvent(text: string) {
  return postJSON<{ event: HistoricalEvent }>("/api/seed", { text });
}

export function generateEffects(event: HistoricalEvent, n = 5) {
  return postJSON<{ effects: CausalItem[] }>("/api/effects", { event, n });
}

export function generateCauses(event: HistoricalEvent, n = 5) {
  return postJSON<{ causes: CausalItem[] }>("/api/causes", { event, n });
}

export function generateBridge(from: HistoricalEvent, to: HistoricalEvent) {
  return postJSON<{
    intermediate: HistoricalEvent | null;
    fromStrength: Strength;
    toStrength: Strength;
    reasoning: string;
  }>("/api/bridge", { from, to });
}
