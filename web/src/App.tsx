import { useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EventNode, type EventNodeType } from "./EventNode";
import { CausalEdge, type CausalEdgeType } from "./CausalEdge";
import { GraphActionsContext } from "./GraphActions";
import * as api from "./api";
import type { CausalItem, HistoricalEvent, Strength } from "./types";

const nodeTypes = { event: EventNode };
const edgeTypes = { causal: CausalEdge };

let idCounter = 1;
const newId = () => `n${idCounter++}`;
const newEdgeId = () => `e${idCounter++}`;

const GRAPH_STORAGE_KEY = "history-effects:graph:v1";
const FAN_X = 300;
const FAN_Y = 220;

const eventOf = (n: EventNodeType): HistoricalEvent => ({
  title: n.data.title,
  description: n.data.description,
});

const placeholderNode = (id: string, position: { x: number; y: number }, title = "Thinking…"): EventNodeType => ({
  id,
  type: "event",
  position,
  data: { title, description: "", loading: true },
});

const placeholderEdge = (id: string, source: string, target: string): CausalEdgeType => ({
  id,
  type: "causal",
  source,
  target,
  data: { strength: "contributing", loading: true },
});

const fanPosition = (source: EventNodeType, i: number, count: number, direction: "up" | "down") => ({
  x: source.position.x + (i - (count - 1) / 2) * FAN_X,
  y: source.position.y + (direction === "down" ? FAN_Y : -FAN_Y),
});

const childEdge = (source: EventNodeType, childId: string, item: CausalItem, direction: "up" | "down"): CausalEdgeType => ({
  id: newEdgeId(),
  type: "causal",
  source: direction === "down" ? source.id : childId,
  target: direction === "down" ? childId : source.id,
  data: { strength: item.strength, reasoning: item.reasoning },
});

const asMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const normalizeTitle = (title: string) => title.trim().toLowerCase();

type StoredGraph = {
  nodes: EventNodeType[];
  edges: CausalEdgeType[];
};

type StateUpdater<T> = T | ((prev: T) => T);

function readStoredGraph(): StoredGraph {
  if (typeof localStorage === "undefined") return { nodes: [], edges: [] };
  const raw = localStorage.getItem(GRAPH_STORAGE_KEY);
  if (!raw) return { nodes: [], edges: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredGraph>;
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.map(restoreNode) : [];
    const edges = Array.isArray(parsed.edges) ? parsed.edges.map(restoreEdge) : [];
    bumpIdCounter(nodes, edges);
    return { nodes, edges };
  } catch {
    localStorage.removeItem(GRAPH_STORAGE_KEY);
    return { nodes: [], edges: [] };
  }
}

function writeStoredGraph(nodes: EventNodeType[], edges: CausalEdgeType[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify({ nodes, edges }));
}

function restoreNode(node: EventNodeType): EventNodeType {
  return {
    ...node,
    data: {
      ...node.data,
      loading: false,
      enriching: false,
      streamText: undefined,
    },
  };
}

function restoreEdge(edge: CausalEdgeType): CausalEdgeType {
  return {
    ...edge,
    data: edge.data ? { ...edge.data, loading: false } : edge.data,
  };
}

function bumpIdCounter(nodes: EventNodeType[], edges: CausalEdgeType[]) {
  const maxId = [...nodes.map((n) => n.id), ...edges.map((e) => e.id)]
    .map((id) => Number(id.slice(1)))
    .filter(Number.isFinite)
    .reduce((max, id) => Math.max(max, id), 0);
  idCounter = Math.max(idCounter, maxId + 1);
}

function applyStateUpdater<T>(prev: T, updater: StateUpdater<T>): T {
  return typeof updater === "function" ? (updater as (current: T) => T)(prev) : updater;
}

function collectDownstreamIds(sourceId: string, edges: CausalEdgeType[]): string[] {
  const found = new Set<string>();
  const queue = [sourceId];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    for (const edge of edges) {
      if (edge.source !== id || found.has(edge.target)) continue;
      found.add(edge.target);
      queue.push(edge.target);
    }
  }

  return [...found];
}

function AppInner() {
  const [initialGraph] = useState(readStoredGraph);
  const [nodes, setNodesState] = useState<EventNodeType[]>(initialGraph.nodes);
  const [edges, setEdgesState] = useState<CausalEdgeType[]>(initialGraph.edges);
  const [seedText, setSeedText] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { screenToFlowPosition, getNodes } = useReactFlow<EventNodeType, CausalEdgeType>();

  const setNodes = (updater: StateUpdater<EventNodeType[]>) =>
    setNodesState((prev) => {
      const next = applyStateUpdater(prev, updater);
      const stored = readStoredGraph();
      writeStoredGraph(next, stored.edges);
      return next;
    });

  const setEdges = (updater: StateUpdater<CausalEdgeType[]>) =>
    setEdgesState((prev) => {
      const next = applyStateUpdater(prev, updater);
      const stored = readStoredGraph();
      writeStoredGraph(stored.nodes, next);
      return next;
    });

  const findNode = (id: string) => getNodes().find((n) => n.id === id);

  const updateNode = (id: string, patch: Partial<EventNodeType["data"]>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));

  const appendNodeStream = (id: string, token: string) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                streamText: `${n.data.streamText ?? ""}${token}`.slice(-900),
              },
            }
          : n
      )
    );

  const updateEdgeData = (id: string, next: NonNullable<CausalEdgeType["data"]>) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: next } : e)));

  const removeNode = (id: string) => setNodes((ns) => ns.filter((n) => n.id !== id));
  const removeEdges = (...ids: string[]) =>
    setEdges((es) => es.filter((e) => !ids.includes(e.id)));

  const hasExpansion = (sourceId: string, direction: "up" | "down") =>
    edges.some((edge) => (direction === "down" ? edge.source === sourceId : edge.target === sourceId));

  const addFannedChildren = (source: EventNodeType, items: CausalItem[], direction: "up" | "down") => {
    if (items.length === 0) return;
    const newNodes = items.map((item, i) => ({
      ...placeholderNode(newId(), fanPosition(source, i, items.length, direction)),
      data: { title: item.title, description: item.description },
    }));
    const newEdges = items.map((item, i) => childEdge(source, newNodes[i].id, item, direction));
    setNodes((ns) => [...ns, ...newNodes]);
    setEdges((es) => [...es, ...newEdges]);
  };

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(asMessage(e));
    }
  };

  const expandEffects = (sourceId: string) =>
    guard(async () => {
      const source = findNode(sourceId);
      if (!source) return;
      if (hasExpansion(sourceId, "down")) return;
      updateNode(sourceId, { streamText: "" });
      try {
        const { effects } = await api.generateEffects(eventOf(source), 5, {
          onToken: (token) => appendNodeStream(sourceId, token),
        });
        addFannedChildren(source, effects, "down");
      } finally {
        updateNode(sourceId, { streamText: undefined });
      }
    });

  const expandCauses = (sourceId: string) =>
    guard(async () => {
      const source = findNode(sourceId);
      if (!source) return;
      if (hasExpansion(sourceId, "up")) return;
      updateNode(sourceId, { streamText: "" });
      try {
        const { causes } = await api.generateCauses(eventOf(source), 5, {
          onToken: (token) => appendNodeStream(sourceId, token),
        });
        addFannedChildren(source, causes, "up");
      } finally {
        updateNode(sourceId, { streamText: undefined });
      }
    });

  const enrichWithWeb = (sourceId: string) =>
    guard(async () => {
      const source = findNode(sourceId);
      if (!source || source.data.loading || source.data.enriching) return;
      updateNode(sourceId, { enriching: true, streamText: "" });
      try {
        const { event } = await api.enrichEvent(eventOf(source), {
          onToken: (token) => appendNodeStream(sourceId, token),
        });
        updateNode(sourceId, {
          title: event.title,
          description: event.description,
          enriching: false,
          streamText: undefined,
        });
      } catch (e) {
        updateNode(sourceId, { enriching: false, streamText: undefined });
        throw e;
      }
    });

  const regenerateNode = (sourceId: string) =>
    guard(async () => {
      const source = findNode(sourceId);
      if (!source || source.data.loading || source.data.enriching) return;
      const childIds = collectDownstreamIds(sourceId, edges);
      if (childIds.length > 0) {
        setNodes((ns) => ns.filter((node) => !childIds.includes(node.id)));
        setEdges((es) => es.filter((edge) => edge.source !== sourceId && !childIds.includes(edge.source) && !childIds.includes(edge.target)));
      }
      updateNode(sourceId, { streamText: "" });
      try {
        const { effects } = await api.generateEffects(eventOf(source), 5, {
          refresh: true,
          onToken: (token) => appendNodeStream(sourceId, token),
        });
        addFannedChildren(source, effects, "down");
      } finally {
        updateNode(sourceId, { streamText: undefined });
      }
    });

  const handleSeed = async () => {
    const text = seedText.trim();
    if (!text || seeding) return;
    setSeeding(true);
    try {
      await guard(async () => {
        const { event } = await api.seedEvent(text);
        const existing = nodes.find((node) => normalizeTitle(node.data.title) === normalizeTitle(event.title));
        if (existing) {
          setSelectedNodeId(existing.id);
          setSelectedEdgeId(null);
          setSeedText("");
          return;
        }
        const id = newId();
        const node: EventNodeType = {
          id,
          type: "event",
          position: { x: 0, y: 0 },
          data: { title: event.title, description: event.description },
        };
        setNodes((ns) => [...ns, node]);
        setSeedText("");
        const { effects } = await api.generateEffects(event, 5, {
          onToken: (token) => appendNodeStream(id, token),
        });
        updateNode(id, { streamText: undefined });
        addFannedChildren(node, effects, "down");
      });
    } finally {
      setSeeding(false);
    }
  };

  const bridgeBetween = (fromNode: EventNodeType, toNode: EventNodeType) =>
    guard(async () => {
      const midId = newId();
      const midPos = {
        x: (fromNode.position.x + toNode.position.x) / 2,
        y: (fromNode.position.y + toNode.position.y) / 2,
      };
      const fromEdgeId = newEdgeId();
      const toEdgeId = newEdgeId();

      setNodes((ns) => [...ns, placeholderNode(midId, midPos, "Bridging…")]);
      setEdges((es) => [
        ...es,
        placeholderEdge(fromEdgeId, fromNode.id, midId),
        placeholderEdge(toEdgeId, midId, toNode.id),
      ]);

      try {
        const res = await api.generateBridge(eventOf(fromNode), eventOf(toNode), {
          onToken: (token) => appendNodeStream(midId, token),
        });
        if (!res.intermediate) {
          removeNode(midId);
          removeEdges(fromEdgeId, toEdgeId);
          setEdges((es) => [
            ...es,
            {
              id: newEdgeId(),
              type: "causal",
              source: fromNode.id,
              target: toNode.id,
              data: { strength: res.fromStrength, reasoning: res.reasoning },
            },
          ]);
          return;
        }
        updateNode(midId, {
          title: res.intermediate.title,
          description: res.intermediate.description,
          loading: false,
          streamText: undefined,
        });
        updateEdgeData(fromEdgeId, { strength: res.fromStrength, reasoning: res.reasoning, loading: false });
        updateEdgeData(toEdgeId, { strength: res.toStrength, reasoning: res.reasoning, loading: false });
      } catch (e) {
        removeNode(midId);
        removeEdges(fromEdgeId, toEdgeId);
        throw e;
      }
    });

  const spawnFromHandle = (
    fromNode: EventNodeType,
    direction: "up" | "down",
    position: { x: number; y: number }
  ) =>
    guard(async () => {
      const nodeId = newId();
      const edgeId = newEdgeId();
      const source = direction === "down" ? fromNode.id : nodeId;
      const target = direction === "down" ? nodeId : fromNode.id;

      setNodes((ns) => [...ns, placeholderNode(nodeId, position)]);
      setEdges((es) => [...es, placeholderEdge(edgeId, source, target)]);

      try {
        const item = await fetchSingleRelated(eventOf(fromNode), direction, (token) => appendNodeStream(nodeId, token));
        if (!item) {
          removeNode(nodeId);
          removeEdges(edgeId);
          return;
        }
        updateNode(nodeId, { title: item.title, description: item.description, loading: false });
        updateEdgeData(edgeId, { strength: item.strength, reasoning: item.reasoning, loading: false });
      } catch (e) {
        removeNode(nodeId);
        removeEdges(edgeId);
        throw e;
      }
    });

  const onConnect = (connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target || source === target) return;
    const fromNode = findNode(source);
    const toNode = findNode(target);
    if (!fromNode || !toNode) return;
    bridgeBetween(fromNode, toNode);
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    if (connectionState.isValid) return;
    const fromNode = connectionState.fromNode as EventNodeType | null;
    const handleType = connectionState.fromHandle?.type;
    if (!fromNode || !handleType) return;
    const { clientX, clientY } = "changedTouches" in event ? event.changedTouches[0] : event;
    const direction = handleType === "source" ? "down" : "up";
    spawnFromHandle(fromNode, direction, screenToFlowPosition({ x: clientX, y: clientY }));
  };

  const actions = {
    expandEffects: (id: string) => void expandEffects(id),
    expandCauses: (id: string) => void expandCauses(id),
    enrichWithWeb: (id: string) => void enrichWithWeb(id),
    regenerateNode: (id: string) => void regenerateNode(id),
  };

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
          <Legend />
          <div className="topbar-hint">
            Drag from the <b>bottom</b> handle of a node into empty space to add an effect, from the <b>top</b> handle to add a cause. Drag between two nodes to bridge them.
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
            onNodesChange={(changes: NodeChange<EventNodeType>[]) =>
              setNodes((ns) => applyNodeChanges(changes, ns))
            }
            onEdgesChange={(changes: EdgeChange<CausalEdgeType>[]) =>
              setEdges((es) => applyEdgeChanges(changes, es))
            }
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
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

          <DetailPanel node={selectedNode} edge={selectedEdge} />
        </div>
      </div>
    </GraphActionsContext.Provider>
  );
}

async function fetchSingleRelated(
  event: HistoricalEvent,
  direction: "up" | "down",
  onToken?: (token: string) => void
): Promise<CausalItem | undefined> {
  if (direction === "down") {
    const { effects } = await api.generateEffects(event, 1, { onToken });
    return effects[0];
  }
  const { causes } = await api.generateCauses(event, 1, { onToken });
  return causes[0];
}

function Legend() {
  return (
    <div className="topbar-legend">
      <LegendChip strength="primary" label="primary" />
      <LegendChip strength="contributing" label="contributing" />
      <LegendChip strength="minor" label="minor" />
    </div>
  );
}

function LegendChip({ strength, label }: { strength: Strength; label: string }) {
  return <span className={`legend-chip strength-${strength}`}>{label}</span>;
}

function DetailPanel({ node, edge }: { node?: EventNodeType; edge?: CausalEdgeType }) {
  if (!node && !edge) return null;
  return (
    <aside className="detail-panel">
      {node && (
        <>
          <div className="detail-label">Event</div>
          <div className="detail-title">{node.data.title}</div>
          <div className="detail-body">{node.data.description}</div>
        </>
      )}
      {edge && (
        <>
          <div className="detail-label">Causal link</div>
          <div className={`detail-strength strength-${edge.data?.strength}`}>{edge.data?.strength}</div>
          <div className="detail-body">
            {edge.data?.reasoning || <em style={{ opacity: 0.6 }}>No reasoning provided.</em>}
          </div>
        </>
      )}
    </aside>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
