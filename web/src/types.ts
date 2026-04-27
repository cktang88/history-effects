export type Strength = "primary" | "contributing" | "minor";

export type HistoricalEvent = {
  title: string;
  description: string;
};

export type CausalItem = HistoricalEvent & {
  strength: Strength;
  reasoning: string;
};

export type EventNodeData = HistoricalEvent & {
  loading?: boolean;
};

export type CausalEdgeData = {
  strength: Strength;
  reasoning?: string;
  loading?: boolean;
};

export const STRENGTH_COLOR: Record<Strength, string> = {
  primary: "#dc2626",
  contributing: "#f59e0b",
  minor: "#6b7280",
};

export const STRENGTH_WIDTH: Record<Strength, number> = {
  primary: 3,
  contributing: 2,
  minor: 1.5,
};

export const STRENGTH_DASH: Record<Strength, string | undefined> = {
  primary: undefined,
  contributing: undefined,
  minor: "5 4",
};
