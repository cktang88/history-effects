import { useState } from "react";
import * as atlas from "../atlas/api";
import { AGES, ERAS, eraOf, type Era } from "../atlas/eras";
import { useQuery } from "../atlas/useQuery";
import { addSlice, dateLabelOf, KIND_LABEL, openEntity } from "../graph/atlasActions";
import { useGraph } from "../graph/store";

const DEFAULT_ERA = eraOf(1840);

// Browse history by age × region × lens: the most significant entities of
// each slice, ranked by how many Wikipedias cover them.
export function AtlasPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [era, setEra] = useState<Era>(DEFAULT_ERA);
  const [age, setAge] = useState(DEFAULT_ERA.age);
  const [region, setRegion] = useState("all");
  const [lens, setLens] = useState("all");
  const meta = useQuery("meta", atlas.meta);
  const key = `browse:${era.id}:${region}:${lens}`;
  const result = useQuery(open ? key : null, () => atlas.browse({ from: era.from, to: era.to, region, lens, limit: 40 }));
  const onMapIds = useGraph((s) => s.nodes.map((n) => n.id).join(","));
  const onMapSet = new Set(onMapIds.split(","));
  const items = result.data?.items ?? [];
  const maxSig = Math.max(1, ...items.map((e) => e.sig));

  const pickAge = (a: string) => {
    setAge(a);
    const first = ERAS.find((e) => e.age === a);
    if (first) setEra(first);
  };

  return (
    <aside className={`atlas${open ? " is-open" : ""}`} aria-hidden={!open}>
      <div className="atlas-head">
        <div>
          <div className="eyebrow">Atlas</div>
          <h2 className="atlas-title">
            {era.label}
            {region !== "all" && <span className="muted"> · {region}</span>}
          </h2>
        </div>
        <button className="inspector-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <div className="atlas-controls">
        <div className="seg seg-scroll">
          {AGES.map((a) => (
            <button key={a} className={a === age ? "on" : ""} onClick={() => pickAge(a)}>
              {a}
            </button>
          ))}
        </div>
        <div className="era-strip">
          {ERAS.filter((e) => e.age === age).map((e) => (
            <button key={e.id} className={`era${e.id === era.id ? " on" : ""}`} onClick={() => setEra(e)}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            <option value="all">All regions</option>
            {meta.data?.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
          <select value={lens} onChange={(e) => setLens(e.target.value)} aria-label="Lens">
            <option value="all">Everything</option>
            {meta.data?.lenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="atlas-list">
        {result.loading && <div className="muted small atlas-empty">Loading…</div>}
        {result.error && <div className="muted small atlas-empty">Couldn't load: {result.error}</div>}
        {!result.loading && items.length === 0 && !result.error && (
          <div className="muted small atlas-empty">Nothing significant recorded for this slice. Try a wider era or another region.</div>
        )}
        {items.map((e, i) => (
          <button key={e.id} className={`atlas-row${onMapSet.has(e.id) ? " on-map" : ""}`} onClick={() => openEntity(e.id)}>
            <span className="atlas-rank">{i + 1}</span>
            <span className="atlas-thumb">{e.img && <img src={atlas.imageUrl(e.img, 80)} alt="" loading="lazy" />}</span>
            <span className="atlas-main">
              <span className="atlas-name">{e.title}</span>
              <span className="atlas-meta">
                {KIND_LABEL[e.kind] ?? e.kind} · {dateLabelOf(e)}
                {e.country ? ` · ${e.country}` : ` · ${e.region}`}
              </span>
            </span>
            <span className="atlas-sig" title={`Covered by ${e.sig} Wikipedia language editions`}>
              <i style={{ width: `${Math.max(8, (e.sig / maxSig) * 100)}%` }} />
            </span>
          </button>
        ))}
      </div>

      {items.length > 0 && (
        <div className="atlas-foot">
          <span className="muted small">
            {result.data?.total} recorded · ranked by significance
          </span>
          <button className="btn btn-primary" onClick={() => addSlice(era, region, lens)}>
            Map the top {Math.min(12, items.length)}
          </button>
        </div>
      )}
    </aside>
  );
}
