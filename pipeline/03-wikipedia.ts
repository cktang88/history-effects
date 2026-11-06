// Step 3b: parse each entity's English Wikipedia article (from 03a-dump.py).
// Keep its lead summary, and every link that appears in a "before" section (Background,
// Causes, Prelude…) or an "after" section (Aftermath, Legacy, Impact…),
// together with the sentence it appears in, as evidence for causal links.
// Output: pipeline/out/wiki.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { log } from "./lib.ts";

export type SectionKind = "before" | "after";
export type WikiLink = { target: string; kind: SectionKind; heading: string; sentence: string };
export type WikiArticle = { title: string; summary: string; links: WikiLink[]; redirects: string[] };

const BEFORE = /\b(background|causes?|prelude|origins?|antecedents?|road to|lead[- ]up|events leading|precursors?|context|build[- ]up|outbreak)\b/i;
const AFTER = /\b(aftermath|consequences?|legacy|impact|effects?|outcome|significance|results?|influence|repercussions?|after the|later history|reception|commemoration)\b/i;
const SKIP = /\b(popular culture|see also|references|notes|further reading|external links|bibliography|sources|citations|gallery|footnotes|in fiction|in film)\b/i;

const OUT_DIR = new URL("./out/wiki/", import.meta.url);

// --- wikitext → plain text with link spans ----------------------------------------

function stripTemplates(s: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}" && depth > 0) {
      depth--;
      i++;
    } else if (depth === 0) out += s[i];
  }
  return out;
}

function stripFiles(s: string): string {
  // [[File:...]] can contain nested [[links]]; drop the whole thing.
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[File:", i) || s.startsWith("[[Image:", i) || s.startsWith("[[Category:", i)) {
      let depth = 0;
      for (; i < s.length; i++) {
        if (s[i] === "[" && s[i + 1] === "[") depth++, i++;
        else if (s[i] === "]" && s[i + 1] === "]") {
          depth--;
          i++;
          if (depth === 0) break;
        }
      }
      continue;
    }
    out += s[i];
  }
  return out;
}

export function cleanWikitext(s: string): string {
  return stripFiles(
    stripTemplates(
      s
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<ref[^>]*\/>/g, "")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    )
  )
    .replace(/<[^>]+>/g, "")
    .replace(/'{2,}/g, "");
}

export function normalizeTitle(t: string): string {
  const s = t.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Returns link targets with the sentence each appears in.
export function linksWithSentences(text: string): { target: string; sentence: string }[] {
  let plain = "";
  const spans: { target: string; start: number; end: number }[] = [];
  const re = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    plain += text.slice(last, m.index);
    const shown = m[2] ?? m[1]!;
    spans.push({ target: normalizeTitle(m[1]!), start: plain.length, end: plain.length + shown.length });
    plain += shown;
    last = m.index + m[0].length;
  }
  plain += text.slice(last);
  const bounds: number[] = [0];
  for (const m of plain.matchAll(/(?<=[.!?])\s+(?=[A-Z"“(])|\n+/g)) bounds.push(m.index! + m[0].length);
  bounds.push(plain.length);
  return spans.map((sp) => {
    let i = 0;
    while (i < bounds.length - 1 && bounds[i + 1]! <= sp.start) i++;
    const sentence = plain.slice(bounds[i]!, bounds[i + 1]).replace(/\s+/g, " ").trim();
    return { target: sp.target, sentence: sentence.length > 400 ? sentence.slice(0, 400) + "…" : sentence };
  });
}

export function extractSectionLinks(wikitext: string): WikiLink[] {
  const parts = wikitext.split(/^(={2,6})\s*(.+?)\s*\1\s*$/m);
  const out: WikiLink[] = [];
  // parts: [lead, eq, heading, body, eq, heading, body, ...]. Subsections
  // inherit the kind of their parent level-2 heading.
  let parentKind: SectionKind | null = null;
  for (let i = 1; i < parts.length; i += 3) {
    const level = parts[i]!.length;
    const heading = cleanWikitext(parts[i + 1]!).trim();
    const body = parts[i + 2] ?? "";
    const own: SectionKind | null = SKIP.test(heading) ? null : BEFORE.test(heading) ? "before" : AFTER.test(heading) ? "after" : null;
    if (level === 2) parentKind = SKIP.test(heading) ? null : own;
    const kind = own ?? (level > 2 ? parentKind : null);
    if (!kind) continue;
    for (const l of linksWithSentences(cleanWikitext(body))) out.push({ ...l, kind, heading });
  }
  return out;
}

// --- summaries ---------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Renders one innermost template (no nested {{ }} inside): the few that carry
// visible text in leads (dates, dashes, "circa", language/Japanese names)
// become text; all others are dropped.
function renderTemplate(body: string): string {
  const parts = body.split("|").map((p) => p.trim());
  const name = (parts[0] ?? "").toLowerCase().replace(/_/g, " ");
  const positional = parts.slice(1).filter((p) => !/^[a-z0-9 _-]+\s*=/i.test(p));
  if (/^(birth|death|start|end) date( and age)?$/.test(name)) {
    const [y, mo, d] = positional;
    return [d && Number(d), mo && MONTHS[Number(mo) - 1], y].filter(Boolean).join(" ");
  }
  if (/^(snd|spnd|sndash|spaced n?dash|spaced en dash)$/.test(name)) return " – ";
  if (/^(ndash|en dash)$/.test(name)) return "–";
  if (/^(mdash|em dash)$/.test(name)) return "—";
  if (/^(circa|c\.)$/.test(name)) return positional[0] ? `c. ${positional[0]}` : "c. ";
  if (/^(bce|bc)$/.test(name)) return `${positional[0] ?? ""} BCE`;
  if (/^(ce|ad)$/.test(name)) return `${positional[0] ?? ""} CE`;
  if (name.startsWith("nihongo")) return positional[0] ?? "";
  if (/^(lang|langx|lang-[a-z-]+|transl|transliteration|nowrap|nobr|small|nobold|em|sic|linktext)$/.test(name)) {
    return positional[positional.length - 1] ?? "";
  }
  return "";
}

export function renderInlineTemplates(s: string): string {
  let out = s;
  for (let i = 0; i < 30 && out.includes("{{"); i++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_m, body: string) => renderTemplate(body));
    if (next === out) break;
    out = next;
  }
  return out;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

// First few sentences of the lead, as plain text.
export function leadSummary(wikitext: string, maxChars = 600): string {
  const raw = (wikitext.split(/^==[^=]/m)[0] ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  const text = decodeEntities(cleanWikitext(renderInlineTemplates(raw)))
    .replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s*([^\]]*)\]/g, "$1")
    .replace(/__[A-Z]+__/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\(\s*(?:[;,]\s*)*\)/g, "")
    .replace(/\(\s*(?:[;,]\s*)+/g, "(")
    .replace(/\s+([,.;])/g, "$1")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 40 && !/^[|!{}*#:;]/.test(l) && !/\bnavigation\b|^This (is|article) (a|part of)/i.test(l))
    .join(" ");
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = cut.lastIndexOf(". ");
  return end > 200 ? cut.slice(0, end + 1) : cut + "…";
}

// --- main --------------------------------------------------------------------------

async function main() {
  const { createGunzip } = await import("node:zlib");
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const dumpDir = new URL("./out/dump/", import.meta.url);
  const redirects = JSON.parse(await readFile(new URL("redirects.json", dumpDir), "utf8")) as Record<string, string[]>;
  const lines = createInterface({ input: createReadStream(new URL("articles.jsonl.gz", dumpDir)).pipe(createGunzip()) });
  const articles: WikiArticle[] = [];
  for await (const line of lines) {
    if (!line) continue;
    const { title, wikitext } = JSON.parse(line) as { title: string; wikitext: string };
    if (/^#redirect/i.test(wikitext.trim())) continue;
    articles.push({ title, summary: leadSummary(wikitext), links: extractSectionLinks(wikitext), redirects: redirects[title] ?? [] });
  }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL("../wiki.json", OUT_DIR), JSON.stringify(articles));
  log(`extracted ${articles.length} articles, ${articles.reduce((n, a) => n + a.links.length, 0)} section links`);
}

if (import.meta.main) await main();
