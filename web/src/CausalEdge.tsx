import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { STRENGTH_COLOR, STRENGTH_DASH, STRENGTH_WIDTH, type CausalEdgeData } from "./types";

export type CausalEdgeType = Edge<CausalEdgeData, "causal">;

export function CausalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<CausalEdgeType>) {
  const strength = data?.strength ?? "contributing";
  const loading = data?.loading;
  const color = loading ? "#9ca3af" : STRENGTH_COLOR[strength];
  const width = STRENGTH_WIDTH[strength];
  const dash = loading ? "4 4" : STRENGTH_DASH[strength];

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dash,
          opacity: loading ? 0.6 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-chip strength-${strength}${selected ? " selected" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={data?.reasoning || ""}
        >
          {loading ? "…" : strength}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
