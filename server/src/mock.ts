// Offline stand-in for the LLM, enabled with MOCK_LLM=1. Streams plausible,
// correctly shaped JSON with realistic pacing so the UI can be developed and
// demoed without an API key. Content is canned for a few topics and
// templated for everything else — it is not meant to be historically complete.

type MockOptions = {
  label?: string;
  userPrompt: string;
  onToken?: (token: string) => void;
  onReasoning?: (text: string) => void;
};

type E = { title: string; year: number; endYear?: number; dateLabel?: string; place: string; domain: string; description: string };
type L = E & { strength: string; reasoning: string };

const PRESS: E = {
  title: "Gutenberg's Movable-Type Printing Press",
  year: 1440,
  dateLabel: "c. 1440–1450",
  place: "Mainz, Holy Roman Empire",
  domain: "technological",
  description:
    "Johannes Gutenberg combined metal movable type, oil-based ink, and a screw press into a system for mass-producing books. The Gutenberg Bible (c. 1455) showed books could be made faster and cheaper than by hand copying.",
};

const PRESS_EFFECTS: L[] = [
  { title: "Protestant Reformation", year: 1517, endYear: 1648, dateLabel: "1517–1648", place: "Holy Roman Empire", domain: "religious", description: "Martin Luther's challenge to papal authority split Western Christianity. Printed pamphlets spread his arguments across Germany within weeks.", strength: "primary", reasoning: "Luther's Ninety-five Theses and later tracts were reprinted by the hundreds of thousands, letting a local dispute become a continental movement before the Church could suppress it." },
  { title: "Scientific Revolution", year: 1543, endYear: 1687, dateLabel: "1543–1687", place: "Europe", domain: "scientific", description: "A shift to observation, mathematics, and experiment, from Copernicus to Newton. Identical printed tables and diagrams let scholars build on each other's work.", strength: "contributing", reasoning: "Print fixed texts and figures exactly, so astronomers and anatomists could compare, correct, and cumulatively extend shared data instead of degrading manuscript copies." },
  { title: "Rise of Vernacular Literacy", year: 1500, endYear: 1700, dateLabel: "16th–17th c.", place: "Europe", domain: "social", description: "Cheap printed books in German, English, French and other vernaculars widened reading beyond clergy and elites.", strength: "primary", reasoning: "Falling book prices and demand for vernacular Bibles and almanacs created a mass reading public for the first time." },
  { title: "Standardization of European Languages", year: 1530, endYear: 1700, dateLabel: "16th–17th c.", place: "Europe", domain: "cultural", description: "Printers' choices of spelling and dialect hardened into national standards such as Luther's German and Caxton's English.", strength: "contributing", reasoning: "Printers needed one form to sell across regions, so the dialects they chose became the prestige standard." },
  { title: "Birth of the Newspaper", year: 1605, dateLabel: "1605", place: "Strasbourg", domain: "cultural", description: "Johann Carolus's Relation, the first regularly printed newspaper, began a new medium of periodic public news.", strength: "primary", reasoning: "Once presses were common in trading cities, printers could profitably issue regular news sheets to merchants." },
];

const PRESS_CAUSES: L[] = [
  { title: "Paper-Making Spreads to Europe", year: 1150, dateLabel: "12th–14th c.", place: "Iberia and Italy", domain: "technological", description: "Paper technology from China reached Europe via the Islamic world, with mills in Spain and Italy.", strength: "primary", reasoning: "Printing on parchment was too costly; cheap rag paper made large print runs economical." },
  { title: "Growth of Universities and Lay Readership", year: 1200, dateLabel: "13th–15th c.", place: "Europe", domain: "social", description: "Universities, merchants, and urban guilds created rising demand for books that scribes could not meet.", strength: "contributing", reasoning: "Unmet demand for texts gave printing an immediate market and investors willing to fund it." },
  { title: "Rhineland Metalworking Tradition", year: 1400, dateLabel: "15th c.", place: "Rhineland", domain: "technological", description: "Goldsmithing and coin-punch skills in Mainz gave Gutenberg the techniques to cast precise metal type.", strength: "contributing", reasoning: "Casting uniform type required the alloy and punch-cutting know-how of local goldsmiths, Gutenberg's own trade." },
];

const DEATH: E = {
  title: "Black Death",
  year: 1347,
  endYear: 1351,
  dateLabel: "1347–1351",
  place: "Europe, Middle East, North Africa",
  domain: "demographic",
  description:
    "A bubonic plague pandemic caused by Yersinia pestis killed perhaps 30–50% of Europe's population. It arrived via Black Sea trade routes and recurred for centuries.",
};

const DEATH_EFFECTS: L[] = [
  { title: "Collapse of Serfdom in Western Europe", year: 1350, endYear: 1500, dateLabel: "1350–1500", place: "Western Europe", domain: "economic", description: "Labor shortages let peasants demand wages and freedom, eroding manorial obligations in England and France.", strength: "primary", reasoning: "With a third of workers dead, lords competed for labor, and peasants could flee to better terms, undermining bonded labor." },
  { title: "Statute of Labourers", year: 1351, dateLabel: "1351", place: "England", domain: "political", description: "English law attempted to freeze wages at pre-plague levels and restrict worker movement.", strength: "primary", reasoning: "Parliament reacted directly to plague-driven wage spikes by legally capping pay." },
  { title: "Peasants' Revolt", year: 1381, dateLabel: "1381", place: "England", domain: "social", description: "Wat Tyler led a major uprising against poll taxes and labor laws, marching on London.", strength: "contributing", reasoning: "Resentment at the Statute of Labourers' wage caps, layered on poll taxes, fueled the revolt." },
  { title: "Persecution of Jews during the Plague", year: 1348, endYear: 1351, dateLabel: "1348–1351", place: "Holy Roman Empire", domain: "religious", description: "Jews were accused of poisoning wells; hundreds of communities were massacred, as in Strasbourg in 1349.", strength: "primary", reasoning: "Panic sought scapegoats, and existing antisemitism turned plague rumors into massacres." },
  { title: "Italian Renaissance", year: 1400, endYear: 1550, dateLabel: "c. 1400–1550", place: "Italy", domain: "cultural", description: "A revival of classical learning and art centered on Florence.", strength: "minor", reasoning: "Some historians argue concentrated post-plague wealth funded patronage, though the link is debated." },
];

const DEATH_CAUSES: L[] = [
  { title: "Siege of Caffa", year: 1346, dateLabel: "1346", place: "Crimea", domain: "military", description: "The Golden Horde besieged the Genoese port of Caffa, where plague broke out among the besiegers.", strength: "primary", reasoning: "Genoese ships fleeing Caffa carried infected rats and people into Mediterranean ports in 1347." },
  { title: "Pax Mongolica Trade Networks", year: 1250, endYear: 1350, dateLabel: "c. 1250–1350", place: "Eurasia", domain: "economic", description: "Mongol rule unified Eurasian trade routes from China to the Black Sea.", strength: "contributing", reasoning: "Dense overland caravan traffic let the plague travel from Central Asia to the Black Sea." },
  { title: "Great Famine of 1315–1317", year: 1315, endYear: 1317, dateLabel: "1315–1317", place: "Northern Europe", domain: "environmental", description: "Years of heavy rain caused crop failures and mass starvation.", strength: "minor", reasoning: "Malnourished survivors may have been more vulnerable, though the effect on mortality is debated." },
];

const PATH_DEMO_FINAL = "Expensive copying created a strong incentive for a labor-saving way to produce books, which Gutenberg's press supplied.";

const PATH_DEMO = {
  steps: [
    { title: "Collapse of Serfdom in Western Europe", year: 1350, endYear: 1500, dateLabel: "1350–1500", place: "Western Europe", domain: "economic", description: "Labor shortages let peasants demand wages and freedom.", strength: "primary", reasoning: "Mass mortality made labor scarce and valuable." },
    { title: "Rising Cost of Scribal Copying", year: 1400, dateLabel: "c. 1400", place: "Western Europe", domain: "economic", description: "Post-plague wage levels made hand-copied manuscripts expensive just as urban demand for books grew.", strength: "minor", reasoning: "Scarce, well-paid labor raised the price of scribes' work." },
  ],
};

export async function mockCompletion(opts: MockOptions): Promise<string> {
  const content = JSON.stringify(buildResponse(opts.label ?? "", opts.userPrompt), null, 1);
  await streamFake(content, opts);
  return content;
}

async function streamFake(content: string, opts: MockOptions) {
  const thoughts = ["Considering the main historiography. ", "Checking dates and ordering by significance. ", "Choosing concrete mechanisms. "];
  for (const t of thoughts) {
    await sleep(180);
    opts.onReasoning?.(t);
  }
  if (!opts.onToken) return;
  for (let i = 0; i < content.length; i += 12) {
    opts.onToken(content.slice(i, i + 12));
    await sleep(6);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildResponse(label: string, prompt: string): unknown {
  const subject = readSubject(prompt);
  const topic = topicOf(prompt);
  switch (label) {
    case "seed":
    case "enrich":
      return { event: topic?.event ?? genericEvent(subject.title, subject.year) };
    case "explore": {
      const event = topic?.event ?? genericEvent(subject.title, subject.year);
      return { event, effects: topic?.effects ?? genericItems(event, "effect", 5), causes: topic?.causes ?? genericItems(event, "cause", 3) };
    }
    case "effects":
    case "causes": {
      const kind = label === "effects" ? "effect" : "cause";
      const n = Number(prompt.match(/the (\d+) most/)?.[1] ?? 5);
      const canned = topic && !prompt.includes("do NOT repeat") ? (kind === "effect" ? topic.effects : topic.causes) : null;
      const items = (canned ?? genericItems(genericEvent(subject.title, subject.year), kind, n)).slice(0, n);
      return { [label]: items };
    }
    case "path":
      return buildPath(prompt);
    case "explain":
      return {
        mechanism:
          "The first development changed who held resources and leverage. Contemporaries responded with new policies and practices within a generation, and those responses created the conditions in which the later event became possible. Concrete intermediaries — merchants, officials, and printers — carried the change across regions.",
        keyFactors: ["Existing trade networks", "State capacity to respond", "Elite competition"],
        certainty: "debated",
        debate: "Historians agree the link exists but disagree on its weight relative to longer-running economic trends.",
        counterfactual: "Without it, the later event would likely still have occurred, but decades later and in a more regional form.",
      };
    case "bridge":
      return { intermediate: genericEvent(`Intermediate development`, subject.year + 20), fromStrength: "contributing", toStrength: "contributing", reasoning: "Mock bridge." };
    default:
      return {};
  }
}

function buildPath(prompt: string) {
  const from = prompt.match(/FROM:\n(?:Title: |Phrase: )?([^\n(]+)/)?.[1]?.trim() ?? "Earlier event";
  const to = prompt.match(/TO:\n(?:Title: |Phrase: )?([^\n(]+)/)?.[1]?.trim() ?? "Later event";
  const fromYear = Number(prompt.match(/FROM:[^\n]*\n?[^\n]*?\((-?\d{1,4})/)?.[1] ?? 1350);
  const fromEvent = topicOf(from)?.event ?? genericEvent(from, fromYear);
  const toEvent = topicOf(to)?.event ?? genericEvent(to, fromEvent.year + 150);
  const steps = /black death|plague/i.test(from) && /print|press/i.test(to)
    ? PATH_DEMO.steps
    : [1, 2, 3].map((k) => ({
        ...genericEvent(`Step ${k} from ${fromEvent.title}`, fromEvent.year + Math.round(((toEvent.year - fromEvent.year) * k) / 4)),
        strength: k === 2 ? "primary" : "contributing",
        reasoning: `Mock mechanism linking step ${k - 1} to step ${k}.`,
      }));
  return {
    from: fromEvent,
    to: toEvent,
    steps,
    final: { strength: "contributing", reasoning: steps === PATH_DEMO.steps ? PATH_DEMO_FINAL : `The last step created the conditions for ${toEvent.title}.` },
    verdict: "moderate",
    summary: `A mock chain from ${fromEvent.title} to ${toEvent.title}. With a real model this tells the story of the pathway.`,
  };
}

function readSubject(prompt: string): { title: string; year: number } {
  const title = prompt.match(/Title: ([^\n(]+)/)?.[1]?.trim() ?? prompt.match(/Phrase: (.+)/)?.[1]?.trim() ?? "Historical event";
  const year = Number(prompt.match(/Title: [^\n]*\((?:c\. )?(-?\d{1,4})/)?.[1] ?? 1500);
  return { title, year };
}

function topicOf(text: string) {
  const head = text.split("\n\n")[0] ?? text;
  if (/print|gutenberg/i.test(head)) return { event: PRESS, effects: PRESS_EFFECTS, causes: PRESS_CAUSES };
  if (/black death|plague/i.test(head)) return { event: DEATH, effects: DEATH_EFFECTS, causes: DEATH_CAUSES };
  return null;
}

const DOMAIN_CYCLE = ["political", "economic", "social", "military", "cultural", "technological", "religious", "scientific"];

function genericEvent(title: string, year: number): E {
  const clean = title.replace(/^(the|a|an)\s+/i, "");
  return {
    title: clean.charAt(0).toUpperCase() + clean.slice(1),
    year,
    dateLabel: year < 0 ? `${-year} BCE` : String(year),
    place: "Europe",
    domain: DOMAIN_CYCLE[Math.abs(hash(title)) % DOMAIN_CYCLE.length]!,
    description: `Mock description of ${clean}. With a real model this summarizes what happened, where, and who was involved.`,
  };
}

function genericItems(event: E, kind: "effect" | "cause", n: number): L[] {
  const offsets = kind === "effect" ? [3, 12, 30, 80, 150, 6, 45, 200] : [-2, -10, -35, -90, -5, -60, -150, -20];
  const salt = Math.abs(hash(event.title)) % 97;
  return Array.from({ length: n }, (_, i) => ({
    ...genericEvent(`${kind === "effect" ? "Consequence" : "Precursor"} ${String.fromCharCode(65 + i)}${salt} of ${event.title}`, event.year + offsets[i % offsets.length]!),
    domain: DOMAIN_CYCLE[(i + salt) % DOMAIN_CYCLE.length]!,
    strength: i === 0 ? "primary" : i < 3 ? "contributing" : "minor",
    reasoning: `Mock mechanism: ${kind === "effect" ? event.title + " directly enabled this" : "this set up the conditions for " + event.title}.`,
  }));
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
