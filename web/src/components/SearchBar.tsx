import { useState } from "react";
import { connect, explore, resolveEndpoint } from "../graph/actions";
import { parseConnection } from "../graph/model";
import { useGraph } from "../graph/store";

type Mode = "explore" | "connect";

const EXPLORE_STARTERS = [
  "The Black Death",
  "Gutenberg's printing press",
  "Fall of Constantinople",
  "The Columbian Exchange",
  "Treaty of Versailles",
  "Invention of the steam engine",
  "Meiji Restoration",
  "Fall of the Western Roman Empire",
];

const CONNECT_STARTERS: [string, string][] = [
  ["The Black Death", "The Protestant Reformation"],
  ["Gutenberg's printing press", "The French Revolution"],
  ["Treaty of Versailles", "World War II"],
  ["The Opium Wars", "The Chinese Communist Revolution"],
  ["The Columbian Exchange", "The Industrial Revolution"],
];

export function useSearch() {
  const [mode, setMode] = useState<Mode>("explore");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const submit = () => {
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

  return { mode, setMode, text, setText, from, setFrom, to, setTo, submit };
}

type Search = ReturnType<typeof useSearch>;

export function SearchForm({ search, large }: { search: Search; large?: boolean }) {
  const titles = useGraph((s) => s.nodes.map((n) => n.data.title).join("\u0000"));
  const { mode, setMode } = search;
  return (
    <form
      className={`search${large ? " search-large" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        search.submit();
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
          placeholder="Any event, invention, war, idea — or “How did X lead to Y?”"
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
      <button className="search-go" type="submit" aria-label="Go">
        {mode === "explore" ? "Explore" : "Trace"}
      </button>
      <datalist id="all-titles">
        {titles
          .split("\u0000")
          .filter(Boolean)
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </form>
  );
}

export function EmptyState({ search }: { search: Search }) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <h1 className="empty-title">Every event is a cause.</h1>
        <p className="empty-sub">
          Start anywhere in history and follow what it set in motion — or ask how two moments are connected. Each
          link explains <em>how</em> one thing led to another.
        </p>
        <SearchForm search={search} large />
        {search.mode === "explore" ? (
          <div className="starters">
            {EXPLORE_STARTERS.map((s) => (
              <button key={s} className="starter" onClick={() => explore(s)}>
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
        <div className="empty-how">
          <div>
            <b>Timeline map.</b> Left to right is time. Causes sit before their effects.
          </div>
          <div>
            <b>Click</b> any event or link to read why it matters. <b>+</b> grows causes or effects.
          </div>
          <div>
            <b>Keyboard.</b> Arrows to move along the chain, <kbd>E</kbd>/<kbd>C</kbd> to expand, <kbd>?</kbd> for help.
          </div>
        </div>
      </div>
    </div>
  );
}
