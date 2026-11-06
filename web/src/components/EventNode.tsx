import { Handle, Position, type NodeProps } from "@xyflow/react";
import { dateOf } from "../types";
import { expand } from "../graph/actions";
import { useGraph } from "../graph/store";
import type { EventNodeType } from "../graph/model";

const JOB_TEXT = {
  explore: "Reading the history…",
  effects: "Tracing what it led to…",
  causes: "Tracing what led to it…",
  more: "Looking for more…",
  enrich: "Checking sources…",
  path: "Connecting…",
  explain: "Explaining…",
} as const;

export function EventNode({ id, data }: NodeProps<EventNodeType>) {
  const job = useGraph((s) => s.jobs[id]);
  const selected = useGraph((s) => s.selection?.type === "node" && s.selection.id === id);
  const focus = useGraph((s) => (s.focus ? (s.focus.nodes.has(id) ? "lit" : "dim") : "none"));
  const countIn = useGraph((s) => s.edges.reduce((k, e) => k + (e.target === id ? 1 : 0), 0));
  const countOut = useGraph((s) => s.edges.reduce((k, e) => k + (e.source === id ? 1 : 0), 0));
  const pending = job?.kind === "explore" && !data.description;

  const grow = (direction: "effects" | "causes") => (e: React.MouseEvent) => {
    e.stopPropagation();
    void expand(id, direction);
  };

  return (
    <div
      className={`card domain-${data.domain ?? "none"} focus-${focus}${selected ? " is-selected" : ""}${job ? " is-busy" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="handle handle-in" />
      <button className="grow grow-in" title="What caused this? (C)" onClick={grow("causes")} disabled={!!job}>
        {countIn > 0 ? <span className="grow-count">{countIn}</span> : "+"}
      </button>

      <div className="card-meta">
        <span className="card-dot" />
        <span className="card-domain">{data.domain ?? (pending ? "" : "event")}</span>
        <span className="card-date">{dateOf(data)}</span>
        {data.verified && <span className="card-verified" title="Checked against web sources">✓</span>}
      </div>
      <div className="card-title">{data.title}</div>
      {pending ? (
        <div className="skeleton">
          <span />
          <span />
          <span />
        </div>
      ) : job ? null : (
        <div className="card-desc">{data.description}</div>
      )}
      {job && !pending && (
        <div className="card-status">
          <span className="spinner" />
          <span className="card-status-text">{JOB_TEXT[job.kind]}</span>
        </div>
      )}

      <button className="grow grow-out" title="What did this lead to? (E)" onClick={grow("effects")} disabled={!!job}>
        {countOut > 0 ? <span className="grow-count">{countOut}</span> : "+"}
      </button>
      <Handle type="source" position={Position.Right} className="handle handle-out" />
    </div>
  );
}
