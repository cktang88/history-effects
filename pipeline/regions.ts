// World regions used to slice history geographically. Assigned from an
// entity's coordinates when available (they're precise even for states that
// no longer exist), otherwise from its countries' continents.

export const REGIONS = [
  "Europe",
  "Middle East & North Africa",
  "Sub-Saharan Africa",
  "Russia & Central Asia",
  "South Asia",
  "East Asia",
  "Southeast Asia",
  "North America",
  "Latin America",
  "Oceania",
  "Global",
] as const;
export type Region = (typeof REGIONS)[number];

const CONTINENT_REGION: Record<string, Region> = {
  Q46: "Europe",
  Q15: "Sub-Saharan Africa",
  Q48: "East Asia",
  Q49: "North America",
  Q18: "Latin America",
  Q538: "Oceania",
  Q55643: "Oceania",
  Q3960: "Oceania",
  Q27611: "Latin America",
  Q5401: "Europe",
};

export function regionFromCoord(lat: number, lon: number): Region {
  if (lon < -25) {
    if (lon < -140 && lat < 30) return "Oceania";
    // Roughly the US–Mexico border / Florida Straits.
    return lat >= 24.6 ? "North America" : "Latin America";
  }
  if (lon > 150 || (lat < -11 && lon > 110)) return "Oceania";
  if (lat >= 45 && lon >= 45) return "Russia & Central Asia";
  if (lat >= 35 && lat < 45 && lon >= 55 && lon < 80) return "Russia & Central Asia";
  // North of ~36°N and west of the Caucasus is Europe, except eastern
  // Anatolia (east of ~36°E), which goes with the Middle East.
  if (lat >= 36 && lon < 45) return lat < 42 && lon >= 36 ? "Middle East & North Africa" : "Europe";
  if (lat >= 12 && lat < 42 && lon >= 25 && lon < 63) return "Middle East & North Africa";
  if (lat >= 15 && lat < 38 && lon >= -18 && lon < 25) return "Middle East & North Africa";
  if (lat < 15 && lon >= -20 && lon < 55) return "Sub-Saharan Africa";
  if (lat >= 5 && lat < 37 && lon >= 60 && lon < 92) return "South Asia";
  if (lat >= 18 && lon >= 92) return "East Asia";
  if (lat < 18 && lon >= 92) return "Southeast Asia";
  if (lon >= 45 && lon < 63) return "Middle East & North Africa";
  return "Europe";
}

export function regionOf(coord: [number, number] | undefined, continents: string[]): Region {
  // World wars and the like: a single coordinate would misplace them.
  const distinct = new Set(continents.map((c) => CONTINENT_REGION[c]).filter(Boolean));
  if (distinct.size >= 3) return "Global";
  if (coord) return regionFromCoord(coord[0], coord[1]);
  for (const c of continents) if (CONTINENT_REGION[c]) return CONTINENT_REGION[c]!;
  return "Global";
}
