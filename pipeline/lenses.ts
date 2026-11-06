// The "lenses" through which the database views history. Each lens is a set
// of Wikidata classes (or a person query), capped to its most significant
// members by sitelink count: the number of language editions of Wikipedia
// that cover the item, a robust proxy for global historical significance.

export type LensId =
  | "war"
  | "battle"
  | "revolution"
  | "treaty"
  | "disaster"
  | "atrocity"
  | "event"
  | "period"
  | "state"
  | "leader"
  | "thinker"
  | "invention"
  | "idea";

export type Lens = {
  id: LensId;
  label: string;
  limit: number;
  minSitelinks: number;
} & ({ classes: string[] } | { occupations: string[] } | { invention: true });

export const LENSES: Lens[] = [
  { id: "war", label: "Wars", classes: ["Q198"], limit: 900, minSitelinks: 12 },
  { id: "battle", label: "Battles & sieges", classes: ["Q178561", "Q188055"], limit: 1200, minSitelinks: 12 },
  { id: "revolution", label: "Revolutions & uprisings", classes: ["Q10931", "Q124734", "Q45382"], limit: 500, minSitelinks: 12 },
  { id: "treaty", label: "Treaties, alliances & institutions", classes: ["Q131569", "Q625298"], limit: 450, minSitelinks: 12 },
  { id: "disaster", label: "Epidemics, famines & disasters", classes: ["Q12184", "Q3241045", "Q168247", "Q8065"], limit: 300, minSitelinks: 20 },
  { id: "atrocity", label: "Genocides & massacres", classes: ["Q41397", "Q3199915"], limit: 250, minSitelinks: 15 },
  { id: "event", label: "Pivotal events", classes: ["Q13418847", "Q3882219", "Q1361229"], limit: 700, minSitelinks: 25 },
  { id: "period", label: "Eras & movements", classes: ["Q11514315", "Q2198855"], limit: 500, minSitelinks: 25 },
  { id: "state", label: "States & empires", classes: ["Q3024240", "Q48349", "Q417175", "Q1250464"], limit: 900, minSitelinks: 20 },
  {
    id: "leader",
    label: "Rulers & leaders",
    occupations: ["Q82955", "Q116", "Q1402561", "Q3242115", "Q372436", "Q47064", "Q189290"],
    limit: 1300,
    minSitelinks: 70,
  },
  {
    id: "thinker",
    label: "Thinkers, artists & prophets",
    occupations: ["Q4964182", "Q901", "Q15995642", "Q1234713", "Q169470", "Q170790", "Q205375", "Q188094"],
    limit: 700,
    minSitelinks: 90,
  },
  { id: "invention", label: "Inventions & discoveries", invention: true, limit: 1100, minSitelinks: 30 },
  // Populated only by 01b-expand.ts (religions, ideologies, movements).
  { id: "idea", label: "Ideas & religions", classes: [], limit: 0, minSitelinks: 0 },
];
