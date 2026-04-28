import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { EventNodeData } from "./types";
import { useGraphActions } from "./GraphActions";

export type EventNodeType = Node<EventNodeData, "event">;

export function EventNode({ id, data, selected }: NodeProps<EventNodeType>) {
  const actions = useGraphActions();
  const loading = data.loading;

  return (
    <div className={`event-node${selected ? " selected" : ""}${loading ? " loading" : ""}`}>
      <Handle type="target" position={Position.Top} className="handle handle-top" />

      {!loading && (
        <button
          className="node-btn node-btn-causes"
          title="Generate upstream causes"
          onClick={(e) => {
            e.stopPropagation();
            actions.expandCauses(id);
          }}
        >
          ← Causes
        </button>
      )}

      <div className="event-node-title">{data.title || (loading ? "Thinking…" : "Untitled")}</div>
      {data.description && <div className="event-node-desc">{data.description}</div>}

      {!loading && (
        <button
          className="node-btn node-btn-web"
          title="Use web search to add detail"
          disabled={data.enriching}
          onClick={(e) => {
            e.stopPropagation();
            actions.enrichWithWeb(id);
          }}
        >
          {data.enriching ? "Searching…" : "Web detail"}
        </button>
      )}

      {!loading && (
        <button
          className="node-btn node-btn-regen"
          title="Clear generated children and regenerate this node"
          disabled={data.enriching}
          onClick={(e) => {
            e.stopPropagation();
            actions.regenerateNode(id);
          }}
        >
          ↻
        </button>
      )}

      {!loading && (
        <button
          className="node-btn node-btn-effects"
          title="Generate downstream effects"
          onClick={(e) => {
            e.stopPropagation();
            actions.expandEffects(id);
          }}
        >
          Effects →
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="handle handle-bottom" />
    </div>
  );
}
