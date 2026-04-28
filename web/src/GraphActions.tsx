import { createContext, useContext } from "react";

export type GraphActions = {
  expandEffects: (nodeId: string) => void;
  expandCauses: (nodeId: string) => void;
  enrichWithWeb: (nodeId: string) => void;
  regenerateNode: (nodeId: string) => void;
};

export const GraphActionsContext = createContext<GraphActions | null>(null);

export function useGraphActions(): GraphActions {
  const ctx = useContext(GraphActionsContext);
  if (!ctx) throw new Error("GraphActionsContext not provided");
  return ctx;
}
