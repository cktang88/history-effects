import { describe, expect, it } from "vitest";
import { cleanWikitext, extractSectionLinks, leadSummary, linksWithSentences } from "./03-wikipedia.ts";

const article = `{{Infobox war|name=Example {{nested|x}} }}
'''The Example War''' was fought between [[Kingdom of A|A]] and [[B]].<ref>Cite {{c}}</ref> It lasted [[1700s|a decade]].

== Background ==
After the [[Treaty of Old|old treaty]] collapsed, tensions grew. The [[Great Famine]] made it worse.

=== Diplomatic crisis ===
The [[Envoy affair]] sparked the war.

== Battles ==
The [[Battle of C]] was decisive.

== Aftermath ==
The war led to the [[Peace of D]]. [[File:Map.png|thumb|A map with [[Nested link]]]] It also caused the [[Fall of E#Collapse|fall of E]].

== See also ==
* [[Other war]]
`;

describe("extractSectionLinks", () => {
  const links = extractSectionLinks(article);

  it("classifies links by section, including subsections", () => {
    expect(links.filter((l) => l.kind === "before").map((l) => l.target)).toEqual(["Treaty of Old", "Great Famine", "Envoy affair"]);
    expect(links.filter((l) => l.kind === "after").map((l) => l.target)).toEqual(["Peace of D", "Fall of E"]);
  });

  it("ignores neutral sections, see-also lists and file captions", () => {
    const targets = links.map((l) => l.target);
    expect(targets).not.toContain("Battle of C");
    expect(targets).not.toContain("Other war");
    expect(targets).not.toContain("Nested link");
  });

  it("keeps the sentence each link appears in, as displayed text", () => {
    expect(links.find((l) => l.target === "Treaty of Old")!.sentence).toBe("After the old treaty collapsed, tensions grew.");
    expect(links.find((l) => l.target === "Envoy affair")!.heading).toBe("Diplomatic crisis");
  });
});

describe("leadSummary", () => {
  it("returns the lead as plain text without templates or references", () => {
    expect(leadSummary(article)).toBe("The Example War was fought between A and B. It lasted a decade.");
  });
});

describe("leadSummary with inline templates", () => {
  it("keeps dates and words carried by templates", () => {
    const lead =
      "'''A. B.''' ({{IPAc-en|x}}; {{IPA|de|y}}; {{birth date|1889|4|20}}{{snd}}{{death date and age|1945|4|30|1889|4|20}}) was a {{lang|de|Führer}} born {{circa|1880}} in a long sentence.";
    expect(leadSummary(lead)).toBe("A. B. (20 April 1889 – 30 April 1945) was a Führer born c. 1880 in a long sentence.");
  });
});

describe("cleanWikitext / linksWithSentences", () => {
  it("strips comments, refs and bold markup", () => {
    expect(cleanWikitext("a<!-- x -->b<ref name=y/>c<ref>z</ref>'''d'''")).toBe("abcd");
  });

  it("normalizes link targets", () => {
    expect(linksWithSentences("See [[the_thing]].")[0]!.target).toBe("The thing");
  });
});
