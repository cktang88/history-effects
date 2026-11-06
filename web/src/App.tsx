import { useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useStore,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EventNode } from "./components/EventNode";
import { CausalEdge, EdgeMarkers } from "./components/CausalEdge";
import { Inspector } from "./components/Inspector";
import { EmptyState, SearchForm, useSearch } from "./components/SearchBar";
import { AtlasPanel } from "./components/AtlasPanel";
import { ActivityHud, HelpDialog, Legend, TimeRuler, Toasts, Toolbar } from "./components/Overlay";
import { useShortcuts } from "./hooks/useShortcuts";
import { graph, select, undo, useGraph } from "./graph/store";
import {
  connect,
  expand,
  explainEdge,
  fitAll,
  navigate,
  removeEdge,
  removeNodes,
  setFlow,
} from "./graph/actions";
import type { CausalEdgeType, EventNodeType } from "./graph/model";

const nodeTypes = { event: EventNode };
const edgeTypes = { causal: CausalEdge };

function onConnect(c: Connection) {
  if (!c.source || !c.target || c.source === c.target) return;
  void connect({ nodeId: c.source }, { nodeId: c.target }, { replaceDirect: true });
}

function handleKey(e: KeyboardEvent, openHelp: () => void, toggleAtlas: () => void) {
  const { selection } = graph();
  const nodeId = selection?.type === "node" ? selection.id : null;
  const edgeId = selection?.type === "edge" ? selection.id : null;
  const keys: Record<string, () => void> = {
    ArrowLeft: () => navigate("left"),
    ArrowRight: () => navigate("right"),
    ArrowUp: () => navigate("up"),
    ArrowDown: () => navigate("down"),
    e: () => nodeId && void expand(nodeId, "effects"),
    c: () => nodeId && void expand(nodeId, "causes"),
    x: () => edgeId && void explainEdge(edgeId),
    f: fitAll,
    z: undo,
    "?": openHelp,
    a: toggleAtlas,
    "/": () => document.getElementById("search-input")?.focus(),
    Escape: () => {
      (document.activeElement as HTMLElement | null)?.blur();
      select(null);
    },
    Delete: () => (nodeId ? removeNodes([nodeId]) : edgeId && removeEdge(edgeId)),
    Backspace: () => (nodeId ? removeNodes([nodeId]) : edgeId && removeEdge(edgeId)),
  };
  const action = keys[e.key];
  if (!action) return;
  e.preventDefault();
  action();
}

function Canvas() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const hasFocus = useGraph((s) => !!s.focus);
  const far = useStore((s) => s.transform[2] < 0.6);
  const search = useSearch();
  const [help, setHelp] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);

  useShortcuts((e) => handleKey(e, () => setHelp((h) => !h), () => setAtlasOpen((o) => !o)));

  const empty = nodes.length === 0;

  return (
    <div className={`app${hasFocus ? " has-focus" : ""}${far ? " zoom-far" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⟶</span> History Effects
        </div>
        <button className={`atlas-toggle${atlasOpen ? " on" : ""}`} onClick={() => setAtlasOpen(!atlasOpen)} title="Browse by era, region and lens (A)">
          Atlas
        </button>
        {!empty && <SearchForm search={search} />}
        <div className="topbar-spacer" />
      </header>

      <div className="canvas">
        <EdgeMarkers />
        <ReactFlow<EventNodeType, CausalEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setFlow}
          onConnect={onConnect}
          onNodeClick={(_, n) => select({ type: "node", id: n.id })}
          onEdgeClick={(_, e) => select({ type: "edge", id: e.id })}
          onPaneClick={() => select(null)}
          nodesDraggable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          minZoom={0.15}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} className="bg" />
          {!empty && <TimeRuler />}
        </ReactFlow>

        {empty && !atlasOpen && <EmptyState search={search} onAtlas={() => setAtlasOpen(true)} />}
        <AtlasPanel open={atlasOpen} onClose={() => setAtlasOpen(false)} />
        <Inspector />
        {!empty && <Toolbar onHelp={() => setHelp(true)} />}
        {!empty && <Legend />}
        <ActivityHud />
        <Toasts />
        {help && <HelpDialog onClose={() => setHelp(false)} />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
