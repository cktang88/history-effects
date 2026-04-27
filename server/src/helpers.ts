// Pure helpers used by route handlers. Kept separate so they're easy to unit
// test without booting Hono or hitting OpenRouter.

export type Strength = "primary" | "contributing" | "minor";
export type Event = { title: string; description: string };
export type CausalItem = Event & { strength: Strength; reasoning: string };

export function clampN(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : fallback;
  if (!Number.isFinite(v)) return fallback;
  return Math.max(1, Math.min(8, Math.floor(v)));
}

export function normalizeStrength(s: unknown): Strength {
  if (s === "primary" || s === "contributing" || s === "minor") return s;
  return "contributing";
}

export function sanitizeList(list: unknown, n: number): CausalItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is Partial<CausalItem> => !!x && typeof x === "object")
    .slice(0, n)
    .map((x) => ({
      title: String(x.title ?? "").trim() || "Untitled",
      description: String(x.description ?? "").trim(),
      strength: normalizeStrength(x.strength),
      reasoning: String(x.reasoning ?? "").trim(),
    }));
}

export function renderEventPrompt(event: Event, instruction: string): string {
  return `Event:\nTitle: ${event.title}\nDescription: ${event.description ?? ""}\n\n${instruction}`;
}
