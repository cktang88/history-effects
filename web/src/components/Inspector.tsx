import { useState } from "react";
import { dateOf, STRENGTH_HELP, STRENGTH_LABEL, type Explanation, type Strength, type Story } from "../types";
import { useGraph, select, type Job } from "../graph/store";
import {
  connect,
  expand,
  explainEdge,
  findStepsBetween,
  focusEdge,
  focusNode,
  focusStory,
  removeEdge,
  removeNodes,
  resolveEndpoint,
  verify,
} from "../graph/actions";
import { incoming, outgoing, yearsBetween, type CausalEdgeType, type EventNodeType } from "../graph/model";

export function Inspector() {
  const selection = useGraph((s) => s.selection);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const stories = useGraph((s) => s.stories);
  const jobs = useGraph((s) => s.jobs);

  const node = selection?.type === "node" ? nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.type === "edge" ? edges.find((e) => e.id === selection.id) : undefined;
  const story = selection?.type === "story" ? stories.find((s) => s.id === selection.id) : undefined;
  const open = !!(node || edge || story);

  return (
    <aside className={`inspector${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button className="inspector-close" onClick={() => select(null)} title="Close (Esc)">
        ×
      </button>
      <div className="inspector-scroll">
        {node && (
          <NodePanel
            key={node.id}
            node={node}
            nodes={nodes}
            edges={edges}
            stories={stories.filter((s) => s.nodeIds.includes(node.id))}
            job={jobs[node.id]}
          />
        )}
        {edge && <EdgePanel key={edge.id} edge={edge} nodes={nodes} job={jobs[edge.id]} />}
        {story && <StoryPanel key={story.id} story={story} nodes={nodes} edges={edges} />}
      </div>
    </aside>
  );
}

function NodePanel({
  node,
  nodes,
  edges,
  stories,
  job,
}: {
  node: EventNodeType;
  nodes: EventNodeType[];
  edges: CausalEdgeType[];
  stories: Story[];
  job?: Job;
}) {
  const d = node.data;
  const causes = incoming(edges, node.id);
  const effects = outgoing(edges, node.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="panel">
      <div className="panel-meta">
        {d.domain && <span className={`chip domain-${d.domain}`}>{d.domain}</span>}
        <span>{dateOf(d)}</span>
        {d.place && <span className="muted">· {d.place}</span>}
      </div>
      <h2 className="panel-title">{d.title}</h2>
      <p className="panel-body">{d.description || <span className="muted">Loading…</span>}</p>
      {d.verified && <div className="verified-note">✓ Details checked against web sources</div>}

      <div className="panel-actions">
        <button className="btn" onClick={() => expand(node.id, "causes")} disabled={!!job}>
          ← {causes.length ? "More causes" : "What caused this?"}
        </button>
        <button className="btn btn-primary" onClick={() => expand(node.id, "effects")} disabled={!!job}>
          {effects.length ? "More effects" : "What did it lead to?"} →
        </button>
      </div>
      {job && <JobLine job={job} />}

      <LinkList title="Caused by" empty="No causes explored yet." edges={causes} other={(e) => byId.get(e.source)} />
      <LinkList title="Led to" empty="No effects explored yet." edges={effects} other={(e) => byId.get(e.target)} />

      {stories.length > 0 && (
        <section>
          <h3 className="section-title">Part of traced chains</h3>
          {stories.map((s) => (
            <button key={s.id} className="story-link" onClick={() => focusStory(s.id)}>
              {byId.get(s.fromId)?.data.title} <span className="muted">→</span> {byId.get(s.toId)?.data.title}
            </button>
          ))}
        </section>
      )}

      <TraceBox nodeId={node.id} nodes={nodes} />

      <div className="panel-footer">
        <button className="link-btn" onClick={() => verify(node.id)} disabled={!!job}>
          Verify with web sources
        </button>
        <button className="link-btn danger" onClick={() => removeNodes([node.id])}>
          Remove from map
        </button>
      </div>
    </div>
  );
}

function LinkList({
  title,
  empty,
  edges,
  other,
}: {
  title: string;
  empty: string;
  edges: CausalEdgeType[];
  other: (e: CausalEdgeType) => EventNodeType | undefined;
}) {
  const items = edges
    .map((e) => ({ e, n: other(e) }))
    .filter((x): x is { e: CausalEdgeType; n: EventNodeType } => !!x.n)
    .sort((a, b) => (a.n.data.year ?? 0) - (b.n.data.year ?? 0));
  return (
    <section className="links">
      <h3 className="section-title">
        {title} <span className="muted">{items.length || ""}</span>
      </h3>
      {items.length === 0 && <p className="muted small">{empty}</p>}
      {items.map(({ e, n }) => (
        <div key={e.id} className={`link-row strength-${e.data?.strength}`}>
          <button className="link-row-head" onClick={() => focusNode(n.id)} title="Go to this event">
            <StrengthBar strength={e.data?.strength ?? "contributing"} />
            <span className="link-row-title">{n.data.title}</span>
            <span className="link-row-date">{dateOf(n.data)}</span>
          </button>
          {e.data?.reasoning && (
            <button className="link-row-why" onClick={() => focusEdge(e.id)} title="Open this link">
              {e.data.reasoning}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function TraceBox({ nodeId, nodes }: { nodeId: string; nodes: EventNodeType[] }) {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<"to" | "from">("to");
  const submit = () => {
    if (!text.trim()) return;
    const here = { nodeId };
    const there = resolveEndpoint(text);
    void (direction === "to" ? connect(here, there) : connect(there, here));
    setText("");
  };
  return (
    <section className="trace">
      <h3 className="section-title">Trace a connection</h3>
      <div className="trace-row">
        <select value={direction} onChange={(e) => setDirection(e.target.value as "to" | "from")} aria-label="Direction">
          <option value="to">How did this lead to…</option>
          <option value="from">How did … lead to this</option>
        </select>
      </div>
      <form
        className="trace-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          list="map-titles"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={direction === "to" ? "e.g. the French Revolution" : "e.g. the fall of Rome"}
        />
        <button className="btn" type="submit" disabled={!text.trim()}>
          Trace
        </button>
      </form>
      <datalist id="map-titles">
        {nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => (
            <option key={n.id} value={n.data.title} />
          ))}
      </datalist>
    </section>
  );
}

function EdgePanel({ edge, nodes, job }: { edge: CausalEdgeType; nodes: EventNodeType[]; job?: Job }) {
  const cause = nodes.find((n) => n.id === edge.source);
  const effect = nodes.find((n) => n.id === edge.target);
  if (!cause || !effect || !edge.data) return null;
  const { strength, reasoning, explanation } = edge.data;
  const gap = yearsBetween(cause.data.year, effect.data.year);

  return (
    <div className="panel">
      <div className="panel-meta">
        <span className="eyebrow">Causal link</span>
      </div>
      <div className="pair">
        <button className="pair-card" onClick={() => focusNode(cause.id)}>
          <span className="pair-date">{dateOf(cause.data)}</span>
          <span className="pair-title">{cause.data.title}</span>
        </button>
        <div className="pair-arrow">
          <span>↓</span>
          {gap && <span className="pair-gap">{gap}</span>}
        </div>
        <button className="pair-card" onClick={() => focusNode(effect.id)}>
          <span className="pair-date">{dateOf(effect.data)}</span>
          <span className="pair-title">{effect.data.title}</span>
        </button>
      </div>

      <div className={`strength-badge strength-${strength}`} title={STRENGTH_HELP[strength]}>
        <StrengthBar strength={strength} /> {STRENGTH_LABEL[strength]}
      </div>
      <p className="strength-help">{STRENGTH_HELP[strength]}</p>

      <h3 className="section-title">How it happened</h3>
      <p className="panel-body">{reasoning || <span className="muted">No mechanism given.</span>}</p>

      {explanation ? (
        <ExplanationView explanation={explanation} />
      ) : (
        <button className="btn btn-primary wide" onClick={() => explainEdge(edge.id)} disabled={!!job}>
          {job ? "Explaining…" : "Explain this connection in depth"}
        </button>
      )}
      {job && <JobLine job={job} />}

      <div className="panel-actions">
        <button className="btn" onClick={() => findStepsBetween(edge.id)}>
          Show the steps in between
        </button>
      </div>
      <div className="panel-footer">
        <button className="link-btn danger" onClick={() => removeEdge(edge.id)}>
          Remove this link
        </button>
      </div>
    </div>
  );
}

const CERTAINTY_TEXT = {
  consensus: "Historians broadly agree",
  debated: "Debated among historians",
  speculative: "Speculative",
} as const;

function ExplanationView({ explanation: x }: { explanation: Explanation }) {
  return (
    <div className="explanation">
      <div className={`certainty certainty-${x.certainty}`}>{CERTAINTY_TEXT[x.certainty]}</div>
      <p className="panel-body">{x.mechanism}</p>
      {x.keyFactors.length > 0 && (
        <>
          <h4 className="sub-title">It also took</h4>
          <div className="factor-list">
            {x.keyFactors.map((f) => (
              <span key={f} className="factor">
                {f}
              </span>
            ))}
          </div>
        </>
      )}
      {x.debate && (
        <>
          <h4 className="sub-title">What's debated</h4>
          <p className="panel-body small">{x.debate}</p>
        </>
      )}
      {x.counterfactual && (
        <>
          <h4 className="sub-title">What if it hadn't happened?</h4>
          <p className="panel-body small">{x.counterfactual}</p>
        </>
      )}
    </div>
  );
}

const VERDICT_TEXT = {
  strong: "Strong causal connection",
  moderate: "Real but indirect connection",
  weak: "Weak connection",
  none: "No meaningful causal connection",
} as const;

function StoryPanel({ story, nodes, edges }: { story: Story; nodes: EventNodeType[]; edges: CausalEdgeType[] }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain = story.nodeIds.map((id) => byId.get(id)).filter((n): n is EventNodeType => !!n);
  const first = chain[0];
  const last = chain[chain.length - 1];
  const edgeInto = (id: string) => edges.find((e) => e.target === id && story.edgeIds.includes(e.id));

  return (
    <div className="panel">
      <div className="panel-meta">
        <span className="eyebrow">Causal chain</span>
      </div>
      <h2 className="panel-title">
        How {first?.data.title} led to {last?.data.title}
      </h2>
      {story.verdict && <div className={`verdict verdict-${story.verdict}`}>{VERDICT_TEXT[story.verdict]}</div>}
      {story.summary && <p className="panel-body">{story.summary}</p>}

      <ol className="chain">
        {chain.map((n, i) => {
          const e = i > 0 ? edgeInto(n.id) : undefined;
          return (
            <li key={n.id} className="chain-step">
              {e?.data?.reasoning && (
                <button className={`chain-why strength-${e.data.strength}`} onClick={() => focusEdge(e.id)}>
                  {e.data.reasoning}
                </button>
              )}
              <button className="chain-node" onClick={() => focusNode(n.id)}>
                <span className="chain-dot" />
                <span className="chain-date">{dateOf(n.data)}</span>
                <span className="chain-title">{n.data.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StrengthBar({ strength }: { strength: Strength }) {
  const filled = strength === "primary" ? 3 : strength === "contributing" ? 2 : 1;
  return (
    <span className="strength-bar" aria-label={STRENGTH_LABEL[strength]}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

function JobLine({ job }: { job: Job }) {
  return (
    <div className="job-line">
      <span className="spinner" />
      <span className="job-line-text">{job.thinking ? lastSentence(job.thinking) : job.label}</span>
    </div>
  );
}

export function lastSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.split(/(?<=[.!?])\s+/);
  const last = parts[parts.length - 1] && parts[parts.length - 1]!.length > 20 ? parts[parts.length - 1]! : parts.slice(-2).join(" ");
  return last.length > 140 ? `…${last.slice(-140)}` : last;
}
