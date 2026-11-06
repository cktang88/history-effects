import { useState } from "react";
import { EdgeLabelRenderer, getSmoothStepPath, useInternalNode, useStore, type EdgeProps } from "@xyflow/react";
import { attachRoute, pointAlong, roundedPath, type Point } from "../graph/routes";
import { useGraph } from "../graph/store";
import type { CausalEdgeType } from "../graph/model";
import { STRENGTH_LABEL } from "../types";

const ZERO: Point = { x: 0, y: 0 };

export function CausalEdge({
  id,
  source,
  target,
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

  // ELK's orthogonal route, kept attached to the cards while they animate.
  const route = useGraph((s) => s.routes.get(id));
  const sourceFinal = useGraph((s) => s.targets.get(source));
  const targetFinal = useGraph((s) => s.targets.get(target));
  const sourceLive = useInternalNode(source)?.internals.positionAbsolute;
  const targetLive = useInternalNode(target)?.internals.positionAbsolute;
  const shift = (live?: Point, final?: Point) => (live && final ? { x: live.x - final.x, y: live.y - final.y } : ZERO);

  let path: string;
  let labelX: number;
  let labelY: number;
  if (route && route.length >= 2 && sourceFinal && targetFinal) {
    const points = attachRoute(route, shift(sourceLive, sourceFinal), shift(targetLive, targetFinal));
    path = roundedPath(points, 12);
    ({ x: labelX, y: labelY } = pointAlong(points, 0.5));
  } else {
    // Before the first routed layout: a right-angled path between handles.
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  }

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
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" className={`arrow-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
