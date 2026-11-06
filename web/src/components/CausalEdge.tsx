import { useState } from "react";
import { EdgeLabelRenderer, getSmoothStepPath, useInternalNode, useStore, type EdgeProps } from "@xyflow/react";
import { attachRoute, flowPath, midArrow, pointAlong, type Point } from "../graph/routes";
import { peek, useGraph } from "../graph/store";
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
  // Highlight role relative to what is selected or pointed at: "cause" for
  // links leading into it, "effect" for links leading out of it.
  const focus = useGraph((s) => (s.focus ? (s.focus.edges.has(id) ? (s.focus.upstream?.has(id) ? "cause" : "effect") : "dim") : "none"));
  const peekRole = useGraph((s) =>
    s.peek?.type === "node" ? (s.peek.id === target ? "cause" : s.peek.id === source ? "effect" : "other") : null
  );
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
  let arrow: ReturnType<typeof midArrow> = null;
  if (route && route.length >= 2 && sourceFinal && targetFinal) {
    const points = attachRoute(route, shift(sourceLive, sourceFinal), shift(targetLive, targetFinal));
    path = flowPath(points);
    arrow = midArrow(points);
    ({ x: labelX, y: labelY } = arrow ?? pointAlong(points, 0.5));
  } else {
    // Before the first routed layout: a right-angled path between handles.
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  }

  // The selection's colors win; otherwise what the pointer is over.
  const role = focus === "cause" || focus === "effect" ? focus : peekRole === "cause" || peekRole === "effect" ? peekRole : null;
  const tone = selected || hover ? "lit" : (role ?? "base");
  const state = `focus-${focus === "cause" || focus === "effect" ? "lit" : focus}${role ? ` role-${role}` : ""}${peekRole === "other" && !role ? " peek-other" : ""}${selected ? " is-selected" : ""}${hover ? " is-hover" : ""}`;

  return (
    <>
      {/* A casing in the background color: where a later edge crosses an
          earlier one it cuts a small gap, so it is clear which line passes
          over and each line reads as continuous. */}
      <path d={path} className={`edge-casing edge-${strength} ${state}`} />
      <path
        d={path}
        className={`edge edge-${strength}${data?.source === "ai" ? " edge-ai" : ""} ${state}`}
        pathLength={1}
        markerEnd={`url(#arrow-${tone})`}
      />
      {arrow && arrow.length > 260 && (
        <path
          d="M -6 -6 L 3 0 L -6 6"
          className={`edge-chevron edge-${strength} ${state}`}
          transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle}) scale(${Math.max(1, 0.8 / zoom)})`}
        />
      )}
      {busy && <path d={path} className="edge-busy" />}
      <path
        d={path}
        className="edge-hit"
        onMouseEnter={() => {
          setHover(true);
          peek({ type: "edge", source, target });
        }}
        onMouseLeave={() => {
          setHover(false);
          peek(null);
        }}
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
        {(["base", "lit", "cause", "effect"] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" className={`arrow-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
