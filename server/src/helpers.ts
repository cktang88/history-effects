// Pure helpers used by route handlers. Kept separate so they're easy to unit
// test without booting Hono or hitting OpenRouter.

export type Strength = "primary" | "contributing" | "minor";

export const DOMAINS = [
  "political",
  "military",
  "economic",
  "social",
  "religious",
  "cultural",
  "scientific",
  "technological",
  "demographic",
  "environmental",
] as const;
export type Domain = (typeof DOMAINS)[number];

export type Event = {
  title: string;
  description: string;
  year?: number;
  endYear?: number;
  dateLabel?: string;
  place?: string;
  domain?: Domain;
};
export type CausalItem = Event & { strength: Strength; reasoning: string };

export type ExpandContext = {
  // Titles from the root of the exploration down to (not including) the event.
  path?: string[];
  // Titles already on the user's map, so the model can reuse or avoid them.
  existing?: string[];
  // Titles already linked to this event in the requested direction.
  exclude?: string[];
};

export function clampN(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : fallback;
  if (!Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(8, Math.floor(v)));
}

export function normalizeStrength(s: unknown): Strength {
  if (s === "primary" || s === "contributing" || s === "minor") return s;
  return "contributing";
}

function normalizeDomain(d: unknown): Domain | undefined {
  if (typeof d !== "string") return undefined;
  const lower = d.trim().toLowerCase();
  return (DOMAINS as readonly string[]).includes(lower) ? (lower as Domain) : undefined;
}

function normalizeYear(y: unknown): number | undefined {
  const v = typeof y === "string" ? Number(y.trim()) : y;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < -100_000 || v > 2_100) return undefined;
  return Math.round(v);
}

function optionalString(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const trimmed = s.trim();
  return trimmed || undefined;
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function sanitizeEvent(x: unknown): Event | null {
  if (!x || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  const title = optionalString(e.title);
  if (!title) return null;
  const year = normalizeYear(e.year);
  const endYear = normalizeYear(e.endYear);
  return dropUndefined({
    title,
    description: String(e.description ?? "").trim(),
    year,
    endYear: endYear !== undefined && year !== undefined && endYear > year ? endYear : undefined,
    dateLabel: optionalString(e.dateLabel),
    place: optionalString(e.place),
    domain: normalizeDomain(e.domain),
  });
}

export function sanitizeItem(x: unknown): CausalItem | null {
  if (!x || typeof x !== "object") return null;
  const raw = x as Record<string, unknown>;
  const event = sanitizeEvent({ ...raw, title: optionalString(raw.title) ?? "Untitled" });
  if (!event) return null;
  return {
    ...event,
    strength: normalizeStrength(raw.strength),
    reasoning: String(raw.reasoning ?? "").trim(),
  };
}

export function sanitizeList(list: unknown, n: number): CausalItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => !!x && typeof x === "object")
    .slice(0, n)
    .map((x) => sanitizeItem(x))
    .filter((x): x is CausalItem => x !== null);
}

export function describeEvent(event: Event): string {
  const date = event.dateLabel ?? (event.year !== undefined ? formatYear(event.year) : "");
  const meta = [date, event.place].filter(Boolean).join(", ");
  return `Title: ${event.title}${meta ? ` (${meta})` : ""}\nDescription: ${event.description ?? ""}`;
}

export function formatYear(year: number): string {
  return year < 0 ? `${-year} BCE` : `${year}`;
}

export function renderEventPrompt(event: Event, instruction: string, context: ExpandContext = {}): string {
  const parts = [`Event:\n${describeEvent(event)}`];
  if (context.path?.length) {
    parts.push(`How the user arrived at this event (causal chain they are following):\n${context.path.join(" → ")} → [this event]`);
  }
  if (context.exclude?.length) {
    parts.push(`Already listed for this event — do NOT repeat these, give different ones:\n${bulletList(context.exclude)}`);
  }
  if (context.existing?.length) {
    parts.push(
      `Other events already on the user's map. If one of your items is the same historical event, use its exact title so the map can connect them:\n${bulletList(context.existing)}`
    );
  }
  parts.push(instruction);
  return parts.join("\n\n");
}

function bulletList(items: string[]): string {
  return items.map((t) => `- ${t}`).join("\n");
}

export function sanitizeContext(raw: unknown): ExpandContext {
  if (!raw || typeof raw !== "object") return {};
  const c = raw as Record<string, unknown>;
  return {
    path: stringList(c.path, 8),
    existing: stringList(c.existing, 60),
    exclude: stringList(c.exclude, 20),
  };
}

function stringList(v: unknown, max: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
  return out.length ? out.slice(-max) : undefined;
}
