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

export type HistoricalEvent = {
  title: string;
  description: string;
  year?: number;
  endYear?: number;
  dateLabel?: string;
  place?: string;
  domain?: Domain;
};

export type CausalItem = HistoricalEvent & {
  strength: Strength;
  reasoning: string;
};

export type Explanation = {
  mechanism: string;
  keyFactors: string[];
  certainty: "consensus" | "debated" | "speculative";
  debate: string;
  counterfactual: string;
};

export type Verdict = "strong" | "moderate" | "weak" | "none";

export type PathResult = {
  from: HistoricalEvent;
  to: HistoricalEvent;
  steps: CausalItem[];
  final: { strength: Strength; reasoning: string };
  verdict: Verdict;
  summary: string;
};

export type EventNodeData = HistoricalEvent & {
  // Persistent vertical lane; the layout keeps nodes near their row so the
  // map stays stable as it grows.
  row: number;
  verified?: boolean;
  // "db": a curated entity (node id is its Wikidata id); "ai": model-generated.
  source?: Source;
  kind?: string;
  sig?: number;
  region?: string;
  country?: string;
  // How many sourced causes/effects the database has for this entity.
  nCauses?: number;
  nEffects?: number;
};

export type Source = "db" | "ai";

export type Evidence =
  | { src: "wikidata"; prop: string }
  | { src: "wikipedia"; article: string; section: string; text: string }
  | { src: "curated" };

export type CausalEdgeData = {
  strength: Strength;
  reasoning?: string;
  explanation?: Explanation;
  source?: Source;
  evidence?: Evidence[];
  reviewed?: boolean;
};

export type Story = {
  id: string;
  fromId: string;
  toId: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict?: Verdict;
  summary?: string;
};

export const STRENGTH_LABEL: Record<Strength, string> = {
  primary: "Primary cause",
  contributing: "Contributing factor",
  minor: "Minor / debated",
};

export const STRENGTH_HELP: Record<Strength, string> = {
  primary: "Direct, near-necessary: without it, this likely doesn't happen (or happens very differently).",
  contributing: "One of several real causes.",
  minor: "Peripheral, distal, or debated connection.",
};

export function formatYear(year: number): string {
  return year < 0 ? `${-year} BCE` : `${year}`;
}

export function dateOf(e: HistoricalEvent): string {
  if (e.dateLabel) return e.dateLabel;
  if (e.year === undefined) return "";
  return e.endYear ? `${formatYear(e.year)}–${formatYear(e.endYear)}` : formatYear(e.year);
}
