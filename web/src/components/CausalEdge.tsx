import { useState } from "react";
import { EdgeLabelRenderer, getBezierPath, useStore, type EdgeProps } from "@xyflow/react";
import { useGraph } from "../graph/store";
import type { CausalEdgeType } from "../graph/model";
import { STRENGTH_LABEL } from "../types";

export function CausalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<CausalEdgeType>) {
  const [hover, setHover] = useState(false);
  const selected = useGraph((s) => s.selection?.type === "edge" && s.selection.id === id);
  const focus = useGraph((s) => (s.focus ? (s.focus.edges.has(id) ? "lit" : "dim") : "none"));
  const busy = useGraph((s) => !!s.jobs[id]);
  const strength = data?.strength ?? "contributing";
  // The tooltip lives inside the zoomed canvas; counter-scale it so it reads
  // at the same size at any zoom.
  const zoom = useStore((s) => s.transform[2]);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });

  return (
    <>
      <path
        d={path}
        className={`edge edge-${strength}${data?.source === "ai" ? " edge-ai" : ""} focus-${focus}${selected ? " is-selected" : ""}${hover ? " is-hover" : ""}`}
        pathLength={1}
        markerEnd={`url(#arrow-${selected || focus === "lit" ? "lit" : "base"})`}
      />
      {busy && <path d={path} className="edge-busy" />}
      <path
        d={path}
        className="edge-hit"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {(hover || selected) && data?.reasoning && (
        <EdgeLabelRenderer>
          <div
            className={`edge-tip strength-${strength}`}
            style={{
              transform: `translate(${labelX}px, ${labelY}px) scale(${1 / zoom}) translate(-50%, calc(-100% - 10px))`,
              transformOrigin: "0 0",
            }}
          >
            <div className="edge-tip-strength">
              {STRENGTH_LABEL[strength]} ·{" "}
              {data.source !== "db"
                ? "AI-suggested"
                : data.evidence?.some((e) => e.src === "curated")
                  ? "curated by AI review"
                  : data.reviewed
                    ? "sourced, reviewed"
                    : "sourced"}
            </div>
            <div className="edge-tip-text">{data.reasoning}</div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// Shared arrowhead markers, rendered once inside the flow's SVG layer.
export function EdgeMarkers() {
  return (
    <svg className="edge-markers" aria-hidden>
      <defs>
        {(["base", "lit"] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" className={`arrow-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
