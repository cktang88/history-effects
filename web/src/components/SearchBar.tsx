import { useState } from "react";
import * as atlas from "../atlas/api";
import { useQuery } from "../atlas/useQuery";
import { connect, explore, resolveEndpoint } from "../graph/actions";
import { dateLabelOf, KIND_LABEL, openEntity } from "../graph/atlasActions";
import { parseConnection } from "../graph/model";
import { useGraph } from "../graph/store";

type Mode = "explore" | "connect";

const EXPLORE_STARTERS = [
  "Black Death",
  "French Revolution",
  "Fall of Constantinople",
  "Industrial Revolution",
  "Treaty of Versailles",
  "Meiji Restoration",
  "Thirty Years' War",
  "Protestant Reformation",
];

const CONNECT_STARTERS: [string, string][] = [
  ["Treaty of Versailles", "World War II"],
  ["French Revolution", "Napoleonic Wars"],
  ["Fall of Constantinople", "Age of Discovery"],
  ["First Opium War", "Taiping Rebellion"],
  ["Protestant Reformation", "Thirty Years' War"],
];

let debounce: ReturnType<typeof setTimeout> | undefined;

export function useSearch() {
  const [mode, setMode] = useState<Mode>("explore");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [highlight, setHighlight] = useState(-1);
  // Suggestions follow the text after a short pause, not on every keystroke.
  const [query, setQuery] = useState("");

  const submit = (picked?: atlas.EntitySummary) => {
    if (picked) {
      void openEntity(picked.id);
      setText("");
      setHighlight(-1);
      return;
    }
    if (mode === "explore") {
      if (!text.trim()) return;
      const pair = parseConnection(text);
      if (pair) void connect(resolveEndpoint(pair[0]), resolveEndpoint(pair[1]));
      else void explore(text);
      setText("");
      return;
    }
    if (!from.trim() || !to.trim()) return;
    void connect(resolveEndpoint(from), resolveEndpoint(to));
    setFrom("");
    setTo("");
  };

  return {
    mode,
    setMode,
    text,
    query,
    setText: (t: string) => {
      setText(t);
      setHighlight(-1);
      clearTimeout(debounce);
      debounce = setTimeout(() => setQuery(t), 120);
    },
    from,
    setFrom,
    to,
    setTo,
    submit,
    highlight,
    setHighlight,
  };
}

type Search = ReturnType<typeof useSearch>;

export function SearchForm({ search, large }: { search: Search; large?: boolean }) {
  const titles = useGraph((s) => s.nodes.map((n) => n.data.title).join("\u0000"));
  const { mode, setMode } = search;
  const [focused, setFocused] = useState(false);
  const q = search.query.trim();
  const showSuggestions = mode === "explore" && focused && search.text.trim().length >= 2 && q.length >= 2 && !q.includes("->") && !/^how /i.test(q);
  const suggestions = useQuery(showSuggestions ? `search:${q.toLowerCase()}` : null, () => atlas.search(q, 7));
  const list = showSuggestions ? (suggestions.data ?? []) : [];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (list.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      search.setHighlight(Math.min(list.length - 1, search.highlight + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      search.setHighlight(Math.max(-1, search.highlight - 1));
    }
  };

  return (
    <form
      className={`search${large ? " search-large" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        search.submit(list[search.highlight]);
      }}
    >
      <div className="search-modes" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "explore"} className={mode === "explore" ? "on" : ""} onClick={() => setMode("explore")}>
          Explore
        </button>
        <button type="button" role="tab" aria-selected={mode === "connect"} className={mode === "connect" ? "on" : ""} onClick={() => setMode("connect")}>
          Connect
        </button>
      </div>
      {mode === "explore" ? (
        <input
          id="search-input"
          className="search-input"
          value={search.text}
          onChange={(e) => search.setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="A war, leader, empire, invention… or “How did X lead to Y?”"
          autoComplete="off"
          autoFocus={large}
        />
      ) : (
        <div className="search-pair">
          <input
            id="search-input"
            className="search-input"
            list="all-titles"
            value={search.from}
            onChange={(e) => search.setFrom(e.target.value)}
            placeholder="How did…"
            autoComplete="off"
          />
          <span className="search-arrow">→</span>
          <input
            className="search-input"
            list="all-titles"
            value={search.to}
            onChange={(e) => search.setTo(e.target.value)}
            placeholder="…lead to?"
            autoComplete="off"
          />
        </div>
      )}
      {list.length > 0 && (
        <div className="suggest" role="listbox">
          {list.map((e, i) => (
            <button
              type="button"
              key={e.id}
              role="option"
              aria-selected={i === search.highlight}
              className={`suggest-row${i === search.highlight ? " on" : ""}`}
              onMouseEnter={() => search.setHighlight(i)}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => search.submit(e)}
            >
              <span className="suggest-title">{e.title}</span>
              <span className="suggest-meta">
                {KIND_LABEL[e.kind] ?? e.kind} · {dateLabelOf(e)}
              </span>
            </button>
          ))}
          <div className="suggest-foot">
            Enter on free text asks the AI · <kbd>↑</kbd>
            <kbd>↓</kbd> to choose
          </div>
        </div>
      )}
      <button className="search-go" type="submit" aria-label="Go">
        {mode === "explore" ? "Explore" : "Trace"}
      </button>
      <datalist id="all-titles">
        {[...new Set(titles.split("\u0000"))]
          .filter(Boolean)
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </form>
  );
}

export function EmptyState({ search, onAtlas }: { search: Search; onAtlas: () => void }) {
  const meta = useQuery("meta", atlas.meta);
  return (
    <div className="empty">
      <div className="empty-inner">
        <h1 className="empty-title">How history connects.</h1>
        <p className="empty-sub">
          {meta.data ? `${meta.data.total.toLocaleString()} of history's most significant wars, states, leaders, ideas and turning points` : "History's most significant wars, states, leaders, ideas and turning points"}
          , drawn from Wikipedia and Wikidata, joined by {meta.data ? meta.data.links.toLocaleString() : "thousands of"} sourced
          cause-and-effect links. Start anywhere and follow what it set in motion.
        </p>
        <SearchForm search={search} large />
        {search.mode === "explore" ? (
          <div className="starters">
            {EXPLORE_STARTERS.map((s) => (
              <button key={s} className="starter" onClick={() => void explore(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="starters">
            {CONNECT_STARTERS.map(([a, b]) => (
              <button key={a + b} className="starter" onClick={() => connect({ text: a }, { text: b })}>
                {a} <span className="muted">→</span> {b}
              </button>
            ))}
          </div>
        )}
        <button className="atlas-cta" onClick={onAtlas}>
          Or browse by era and region →
        </button>
        <div className="empty-how">
          <div>
            <b>Timeline map.</b> Left to right is time. Causes sit before their effects.
          </div>
          <div>
            <b>Sourced first.</b> Every link cites its Wikipedia passage. AI only fills gaps, and says so.
          </div>
          <div>
            <b>Keyboard.</b> Arrows to move along the chain, <kbd>E</kbd>/<kbd>C</kbd> to expand, <kbd>?</kbd> for help.
          </div>
        </div>
      </div>
    </div>
  );
}
