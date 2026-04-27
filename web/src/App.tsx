import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EventNode, type EventNodeType } from "./EventNode";
import { CausalEdge, type CausalEdgeType } from "./CausalEdge";
import { GraphActionsContext, type GraphActions } from "./GraphActions";
import * as api from "./api";
import type { CausalEdgeData, HistoricalEvent } from "./types";

const nodeTypes = { event: EventNode };
const edgeTypes = { causal: CausalEdge };

let idCounter = 1;
const newId = () => `n${idCounter++}`;
const newEdgeId = () => `e${idCounter++}`;

const FAN_X = 300;
const FAN_Y = 220;

function AppInner() {
  const [nodes, setNodes] = useState<EventNodeType[]>([]);
  const [edges, setEdges] = useState<CausalEdgeType[]>([]);
  const [seedText, setSeedText] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onNodesChange = useCallback(
    (changes: NodeChange<EventNodeType>[]) =>
      setNodes((ns) => applyNodeChanges(changes, ns)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CausalEdgeType>[]) =>
      setEdges((es) => applyEdgeChanges(changes, es)),
    []
  );

  const findNode = useCallback((id: string) => nodesRef.current.find((n) => n.id === id), []);

  const handleSeed = useCallback(async () => {
    const text = seedText.trim();
    if (!text || seeding) return;
    setSeeding(true);
    setError(null);
    try {
      const { event } = await api.seedEvent(text);
      const id = newId();
      const node: EventNodeType = {
        id,
        type: "event",
        position: { x: 0, y: 0 },
        data: { title: event.title, description: event.description },
      };
      setNodes((ns) => [...ns, node]);
      setSeedText("");
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setSeeding(false);
    }
  }, [seedText, seeding]);

  const expandEffects = useCallback(async (sourceId: string) => {
    const source = findNode(sourceId);
    if (!source) return;
    setError(null);
    try {
      const { effects } = await api.generateEffects(eventOf(source));
      addChildren(source, effects, "down", setNodes, setEdges);
    } catch (e) {
      setError(asMessage(e));
    }
  }, [findNode]);

  const expandCauses = useCallback(async (sourceId: string) => {
    const source = findNode(sourceId);
    if (!source) return;
    setError(null);
    try {
      const { causes } = await api.generateCauses(eventOf(source));
      addChildren(source, causes, "up", setNodes, setEdges);
    } catch (e) {
      setError(asMessage(e));
    }
  }, [findNode]);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target || source === target) return;
    const fromNode = findNode(source);
    const toNode = findNode(target);
    if (!fromNode || !toNode) return;

    // Insert a placeholder intermediate node midway between the two.
    const midId = newId();
    const midX = (fromNode.position.x + toNode.position.x) / 2;
    const midY = (fromNode.position.y + toNode.position.y) / 2;
    const midNode: EventNodeType = {
      id: midId,
      type: "event",
      position: { x: midX, y: midY },
      data: { title: "Bridging…", description: "", loading: true },
    };

    const edgeFromMidId = newEdgeId();
    const edgeMidToId = newEdgeId();
    const placeholderFrom: CausalEdgeType = {
      id: edgeFromMidId,
      type: "causal",
      source: fromNode.id,
      target: midId,
      data: { strength: "contributing", loading: true },
    };
    const placeholderTo: CausalEdgeType = {
      id: edgeMidToId,
      type: "causal",
      source: midId,
      target: toNode.id,
      data: { strength: "contributing", loading: true },
    };

    setNodes((ns) => [...ns, midNode]);
    setEdges((es) => addEdge(placeholderFrom, addEdge(placeholderTo, es)));

    api
      .generateBridge(eventOf(fromNode), eventOf(toNode))
      .then((res) => {
        if (!res.intermediate) {
          // No plausible bridge — drop the mid node and connect directly.
          setNodes((ns) => ns.filter((n) => n.id !== midId));
          setEdges((es) => {
            const cleaned = es.filter((e) => e.id !== edgeFromMidId && e.id !== edgeMidToId);
            const direct: CausalEdgeType = {
              id: newEdgeId(),
              type: "causal",
              source: fromNode.id,
              target: toNode.id,
              data: { strength: res.fromStrength, reasoning: res.reasoning },
            };
            return addEdge(direct, cleaned);
          });
          return;
        }
        const inter = res.intermediate;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === midId
              ? { ...n, data: { title: inter.title, description: inter.description, loading: false } }
              : n
          )
        );
        setEdges((es) =>
          es.map((e) => {
            if (e.id === edgeFromMidId) {
              return { ...e, data: { strength: res.fromStrength, reasoning: res.reasoning, loading: false } };
            }
            if (e.id === edgeMidToId) {
              return { ...e, data: { strength: res.toStrength, reasoning: res.reasoning, loading: false } };
            }
            return e;
          })
        );
      })
      .catch((e) => {
        setError(asMessage(e));
        setNodes((ns) => ns.filter((n) => n.id !== midId));
        setEdges((es) => es.filter((e2) => e2.id !== edgeFromMidId && e2.id !== edgeMidToId));
      });
  }, [findNode]);

  const actions: GraphActions = useMemo(
    () => ({ expandEffects, expandCauses }),
    [expandEffects, expandCauses]
  );

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-title">History Effects</div>
          <div className="topbar-input">
            <input
              type="text"
              placeholder="Type a historical event (e.g., Seven Years' War)…"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSeed();
              }}
              disabled={seeding}
            />
            <button onClick={handleSeed} disabled={seeding || !seedText.trim()}>
              {seeding ? "Adding…" : "Add"}
            </button>
          </div>
          <div className="topbar-legend">
            <LegendChip strength="primary" label="primary" />
            <LegendChip strength="contributing" label="contributing" />
            <LegendChip strength="minor" label="minor" />
          </div>
        </header>

        {error && (
          <div className="error-banner" onClick={() => setError(null)}>
            {error} <span className="dismiss">(click to dismiss)</span>
          </div>
        )}

        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={(_, e) => {
              setSelectedEdgeId(e.id);
              setSelectedNodeId(null);
            }}
            onNodeClick={(_, n) => {
              setSelectedNodeId(n.id);
              setSelectedEdgeId(null);
            }}
            onPaneClick={() => {
              setSelectedEdgeId(null);
              setSelectedNodeId(null);
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            defaultEdgeOptions={{ type: "causal" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} color="#e5e7eb" />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>

          {(selectedEdge || selectedNode) && (
            <aside className="detail-panel">
              {selectedNode && (
                <>
                  <div className="detail-label">Event</div>
                  <div className="detail-title">{selectedNode.data.title}</div>
                  <div className="detail-body">{selectedNode.data.description}</div>
                </>
              )}
              {selectedEdge && (
                <>
                  <div className="detail-label">Causal link</div>
                  <div className={`detail-strength strength-${selectedEdge.data?.strength}`}>
                    {selectedEdge.data?.strength}
                  </div>
                  <div className="detail-body">
                    {selectedEdge.data?.reasoning || <em style={{ opacity: 0.6 }}>No reasoning provided.</em>}
                  </div>
                </>
              )}
            </aside>
          )}
        </div>
      </div>
    </GraphActionsContext.Provider>
  );
}

function eventOf(node: EventNodeType): HistoricalEvent {
  return { title: node.data.title, description: node.data.description };
}

function addChildren(
  source: EventNodeType,
  items: { title: string; description: string; strength: CausalEdgeData["strength"]; reasoning: string }[],
  direction: "up" | "down",
  setNodes: React.Dispatch<React.SetStateAction<EventNodeType[]>>,
  setEdges: React.Dispatch<React.SetStateAction<CausalEdgeType[]>>
) {
  const count = items.length;
  if (count === 0) return;
  const dy = direction === "down" ? FAN_Y : -FAN_Y;
  const newNodes: EventNodeType[] = [];
  const newEdges: CausalEdgeType[] = [];
  items.forEach((item, i) => {
    const id = newId();
    const offset = i - (count - 1) / 2;
    newNodes.push({
      id,
      type: "event",
      position: {
        x: source.position.x + offset * FAN_X,
        y: source.position.y + dy,
      },
      data: { title: item.title, description: item.description },
    });
    newEdges.push({
      id: newEdgeId(),
      type: "causal",
      source: direction === "down" ? source.id : id,
      target: direction === "down" ? id : source.id,
      data: { strength: item.strength, reasoning: item.reasoning },
    });
  });
  setNodes((ns) => [...ns, ...newNodes]);
  setEdges((es) => [...es, ...newEdges]);
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function LegendChip({ strength, label }: { strength: "primary" | "contributing" | "minor"; label: string }) {
  return <span className={`legend-chip strength-${strength}`}>{label}</span>;
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
