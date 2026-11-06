import { useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { clearAll, fitAll } from "../graph/actions";
import { dismissToast, undo, useGraph } from "../graph/store";
import { NODE_W } from "../graph/layout";
import { DOMAINS, STRENGTH_LABEL, type Strength } from "../types";
import { lastSentence } from "./Inspector";

// Year labels pinned to the top of the canvas, following pan and zoom.
export function TimeRuler() {
  const columns = useGraph((s) => s.columns);
  const [tx, , zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  let lastLabel = "";
  return (
    <div className="ruler" aria-hidden>
      {columns.map((c, i) => {
        const x = (c.x + NODE_W / 2) * zoom + tx;
        if (x < -80 || x > width + 80) return null;
        const repeat = c.label === lastLabel;
        lastLabel = c.label;
        return (
          <div key={i} className="ruler-col" style={{ transform: `translateX(${x}px)` }}>
            {c.gapBefore > 25 && <span className="ruler-gap" style={{ left: `${(-165 * zoom)}px` }}>{gapLabel(c.gapBefore)}</span>}
            {!repeat && <span className="ruler-label">{c.label}</span>}
          </div>
        );
      })}
    </div>
  );
}

function gapLabel(years: number): string {
  if (years >= 1000) return `${Math.round(years / 100) / 10}k yrs`;
  return `${years} yrs`;
}

export function ActivityHud() {
  const jobs = useGraph((s) => s.jobs);
  const list = Object.entries(jobs);
  if (list.length === 0) return null;
  return (
    <div className="hud">
      {list.map(([key, job]) => (
        <div key={key} className="hud-row">
          <span className="spinner" />
          <span className="hud-label">{job.label}</span>
          {job.thinking && <span className="hud-thinking">{lastSentence(job.thinking)}</span>}
          <button className="hud-cancel" onClick={() => job.abort.abort()} title="Cancel">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Toasts() {
  const toasts = useGraph((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Toolbar({ onHelp }: { onHelp: () => void }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const canUndo = useGraph((s) => s.history.length > 0);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="toolbar">
      <button onClick={() => zoomOut({ duration: 200 })} title="Zoom out (-)">−</button>
      <button onClick={() => zoomIn({ duration: 200 })} title="Zoom in (+)">+</button>
      <button onClick={fitAll} title="Fit map (F)">⤢</button>
      <span className="toolbar-sep" />
      <button onClick={undo} disabled={!canUndo} title="Undo (Z)">↶</button>
      {confirming ? (
        <button
          className="danger"
          onClick={() => {
            clearAll();
            setConfirming(false);
          }}
          onMouseLeave={() => setConfirming(false)}
        >
          Clear map?
        </button>
      ) : (
        <button onClick={() => setConfirming(true)} title="Start over">
          Clear
        </button>
      )}
      <span className="toolbar-sep" />
      <button onClick={onHelp} title="Keyboard shortcuts (?)">?</button>
    </div>
  );
}

export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`legend${open ? " is-open" : ""}`}>
      <button className="legend-toggle" onClick={() => setOpen(!open)}>
        Legend
      </button>
      {open && (
        <div className="legend-body">
          {(["primary", "contributing", "minor"] as Strength[]).map((s) => (
            <div key={s} className="legend-row">
              <svg width="38" height="10">
                <line x1="2" y1="5" x2="36" y2="5" className={`edge edge-${s}`} />
              </svg>
              {STRENGTH_LABEL[s]}
            </div>
          ))}
          <div className="legend-domains">
            {DOMAINS.map((d) => (
              <span key={d} className={`legend-domain domain-${d}`}>
                <i /> {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["← →", "Move to a cause / an effect"],
  ["↑ ↓", "Move to the event above / below"],
  ["E", "Expand effects of the selected event"],
  ["C", "Expand causes of the selected event"],
  ["X", "Explain the selected link in depth"],
  ["/", "Search"],
  ["F", "Fit the whole map"],
  ["Z", "Undo"],
  ["Delete", "Remove selected event or link"],
  ["Esc", "Deselect"],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard shortcuts</h3>
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="help-row">
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
        <p className="muted small">Drag from an event's right edge onto another event to trace how one led to the other.</p>
      </div>
    </div>
  );
}
