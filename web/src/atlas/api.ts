import type { Strength } from "../types";

export type EntitySummary = {
  id: string;
  title: string;
  kind: string;
  sig: number;
  start: number;
  end?: number;
  region: string;
  country?: string;
  desc?: string;
  nCauses?: number;
  nEffects?: number;
  img?: string;
};

// Sized thumbnail served by Wikimedia Commons.
export const imageUrl = (file: string, width = 480) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;

export type Entity = EntitySummary & { lenses: string[]; summary?: string; wiki?: string };

export type Evidence =
  | { src: "wikidata"; prop: string }
  | { src: "wikipedia"; article: string; section: string; text: string }
  | { src: "curated" };

export type LinkView = {
  id: string;
  source: string;
  target: string;
  strength: Strength;
  reasoning: string;
  score: number;
  evidence: Evidence[];
  reviewed: boolean;
};

export type Detail = {
  entity: Entity;
  causes: LinkView[];
  effects: LinkView[];
  neighbors: EntitySummary[];
  partOf: EntitySummary[];
  parts: EntitySummary[];
  participants: EntitySummary[];
  participatedIn: EntitySummary[];
  preceded: EntitySummary[];
  succeeded: EntitySummary[];
};

export type Meta = {
  lenses: { id: string; label: string; count: number }[];
  regions: { id: string; count: number }[];
  total: number;
  links: number;
};

const memo = new Map<string, Promise<unknown>>();

async function get<T>(path: string): Promise<T> {
  const hit = memo.get(path);
  if (hit) return hit as Promise<T>;
  const p = fetch(path).then(async (res) => {
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as T;
  });
  memo.set(path, p);
  p.catch(() => memo.delete(path));
  return p;
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();

export const meta = () => get<Meta>("/api/atlas/meta");

export const search = (q: string, limit = 8) =>
  get<{ results: EntitySummary[] }>(`/api/atlas/search?${qs({ q, limit })}`).then((r) => r.results);

export const browse = (p: { from: number; to: number; region?: string; lens?: string; limit?: number }) =>
  get<{ total: number; items: EntitySummary[] }>(`/api/atlas/browse?${qs(p)}`);

export const detail = (id: string) => get<Detail>(`/api/atlas/entity/${encodeURIComponent(id)}`);

export const path = (from: string, to: string, skipDirect = false) =>
  get<{ links: LinkView[]; reversed: boolean; entities: EntitySummary[] }>(
    `/api/atlas/path?${qs({ from, to, skipDirect: skipDirect ? 1 : undefined })}`
  );

// All sourced links among a set of entities, in one request.
export async function linksAmong(ids: string[]): Promise<LinkView[]> {
  if (ids.length < 2) return [];
  const res = await fetch("/api/atlas/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`/api/atlas/links: ${res.status}`);
  return ((await res.json()) as { links: LinkView[] }).links;
}
