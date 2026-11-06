# Data pipeline

Builds the curated history database in [`/data`](../data), which the app explores. The LLM is not the source of the graph: entities and links come from Wikidata and Wikipedia. Cheap Haiku agents only *review* candidate links (keep / reject / reverse, plus strength and a one-line mechanism).

History doesn't change much, so the output is committed and rebuilt only occasionally.

## Design

**Lenses, ranked by significance.** Each [lens](lenses.ts) (wars, battles, revolutions, treaties and institutions, disasters, atrocities, pivotal events, eras and movements, states and empires, rulers and leaders, thinkers and artists, inventions, ideas and religions) is a set of Wikidata classes or occupations. Each lens keeps only its top items by **sitelinks**: the number of language editions of Wikipedia that cover the item, a robust proxy for global historical significance. This is how we keep the "high-order bits" instead of every minor skirmish.

**Following Wikipedia's own causal links.** [`01b-expand.ts`](01b-expand.ts) adds topics that many of our articles cite in their *Background/Causes* or *Aftermath/Legacy* sections but that the class queries missed, such as the Reformation, the Meiji Restoration, Islam and nationalism. Places, organizations and languages are filtered out by Wikidata class, since they're settings, not causes.

**Balancing the world: era × region coverage.** Ranking by Wikipedia coverage favors European history. The first build had 301 European entries for 1000–1500 against 7 for Sub-Saharan Africa. [`07-coverage-prep.ts`](07-coverage-prep.ts) lists what each region × era cell already holds. One agent per region names the most significant *missing* items as exact Wikipedia titles. [`07-coverage-merge.ts`](07-coverage-merge.ts) then **verifies every title in code**: it must exist (redirects resolved by [`07b-redirects.py`](07b-redirects.py) from the dump), map to a Wikidata item with enough coverage, start inside its era, and not be a place or organization. Historical polities (kingdoms, empires, caliphates, cultures) are exempt from that last check, since Wikidata models many of them as countries. Survivors go into the committed [`seeds.json`](seeds.json), which [`01c-seeds.ts`](01c-seeds.ts) folds in on every build. In the first pass, 46 proposed titles turned out not to exist and were dropped automatically.

**Two independent sources of causal claims.**
- Wikidata properties: *has cause*, *has effect*, *has immediate cause*, *contributing factor of*, and so on. These are sparse and noisy.
- Wikipedia section links: a link to B inside the *Background/Causes/Prelude* sections of A's article suggests B → A, and inside *Aftermath/Legacy/Impact/Consequences* suggests A → B. The sentence it appears in is kept as evidence.

[`04-build.ts`](04-build.ts) checks candidates for temporal sanity (no cause after its effect; a person is never an "effect"). It scores them by corroboration (two articles agreeing, or Wikipedia plus Wikidata) and by the significance of both ends, then keeps each entity's strongest causes and effects.

**Review.** Even the top candidates are about 60% noise: analogies, namesakes, "inspired centuries later", or a battle "causing" its own war. Haiku reviewers judge the most important links against the evidence. The server shows reviewed links, plus unreviewed ones only when two sources corroborate them.

**Gap-filling.** Strict review leaves some major entities thin. For example, every candidate for the Black Death's effects was noise. [`06-gapfill-prep.ts`](06-gapfill-prep.ts) gives each thin, significant entity a shortlist of plausible database entities: mostly events, nearby in time, preferring the same region. Agents may only choose from that shortlist and must give a mechanism. [`06-gapfill-merge.ts`](06-gapfill-merge.ts) re-checks dates and IDs. These links join two curated nodes but have no source passage, so the app labels them "curated by AI review".

**Regions and eras.** Entities get a region from their coordinates (precise even for vanished states), falling back to continents. "Global" covers anything spanning three or more continents. The app slices time coarsely in deep history (millennia) and finely in modern history (decades after 1800).

## Running it

```bash
bun run data:entities     # 01: Wikidata entities per lens (≈10 min, cached)
cd pipeline && bun run 01b-expand.ts   # after a first 03 run: add frequently cited missing topics
cd pipeline && bun run 01c-seeds.ts     # add the committed seed list
bun run data:relations    # 02: Wikidata relations + countries/continents
cd pipeline && bun run 02b-images.ts    # representative image per entity (Commons filename)
bun run data:wikipedia    # 03a: article wikitext from the dumps (≈1.5 GB of range requests), 03b: parse
bun run data:build        # 04: data/entities.json, links.json, structure.json, lenses.json
bun run data:review-prep  # 05a: batches of the most important unreviewed links
# …run reviewer agents over pipeline/out/review/batch-*.json → result-*.json…
bun run data:review-merge # 05b: validate and merge into data/reviews.json
bun run data:gapfill-prep # 06a: shortlists for thin entities
# …run agents over pipeline/out/gapfill/batch-*.json → result-*.json…
bun run data:gapfill-merge # 06b: validate and merge into data/curated.json
# coverage pass (occasionally): 07-coverage-prep → agents → `07-coverage-merge.ts titles` → 07b-redirects.py → 07-coverage-merge.ts
```

HTTP responses are cached in `pipeline/.cache/` (git-ignored), so reruns are cheap.

**The intermediate snapshot is committed** in `pipeline/out/` (≈28 MB): raw entities, relations, countries, images, the extracted Wikipedia evidence (`wiki.json.gz`), and every agent's inputs and outputs (`review/`, `gapfill/`, `coverage/`), which serve as the audit trail of each AI judgment. With it, `bun run data:build` and the review and gap-fill steps run offline. Only the raw article dump (`out/dump/`, ≈170 MB) and the HTTP cache are left out; `03a-dump.py` re-fetches the dump on demand.

**Why the dumps:** the Wikipedia API rate-limits shared IPs. The multistream dump's index maps every title to a small bz2 block, so [`03a-dump.py`](03a-dump.py) range-requests only the blocks containing our articles, about 5% of the 27 GB dump. Redirects come from the redirect table dump, so links like "Versailles Treaty" resolve.

## Outputs (`/data`)

| File | Contents |
|------|----------|
| `entities.json` | `{id (Wikidata QID), title (Wikipedia title), kind, lenses, sig (sitelinks), start, end, region, country, desc, summary (Wikipedia lead), wiki, img (Commons file)}` |
| `links.json` | candidate causal links `{s, t, score, ev: [evidence]}`; evidence is a Wikidata property or a Wikipedia sentence with article and section |
| `reviews.json` | `"s>t": {verdict, strength, mechanism}` from the review pass |
| `curated.json` | `"s>t": {strength, mechanism}` gap-fill links, chosen from vetted shortlists, no source passage |
| `structure.json` | non-causal context: `part_of`, `participant`, `succeeded_by`, `followed_by` |
| `lenses.json` | lens ids and labels |

Content is derived from Wikipedia (CC BY-SA 4.0) and Wikidata (CC0).
