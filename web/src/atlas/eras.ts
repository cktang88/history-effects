// Time windows for browsing. Coarse in deep time, fine in modern history:
// millennia → half-millennia → quarter-millennia → centuries → half-centuries → decades.

export type Era = { id: string; label: string; from: number; to: number; age: string };

const fmt = (y: number) => (y < 0 ? `${-y} BCE` : `${y}`);

function windows(from: number, to: number, step: number, age: string): Era[] {
  const out: Era[] = [];
  for (let y = from; y < to; y += step) {
    const end = Math.min(y + step, to);
    const label = step === 10 ? `${y}s` : y < 0 && end <= 0 ? `${-y}–${-end} BCE` : `${fmt(y)}–${fmt(end)}`;
    out.push({ id: `${y}_${end}`, label, from: y, to: end, age });
  }
  return out;
}

export const ERAS: Era[] = [
  { id: "pre", label: "Before 3000 BCE", from: -12000, to: -3000, age: "Prehistory" },
  ...windows(-3000, -1000, 1000, "Ancient"),
  ...windows(-1000, 0, 500, "Ancient"),
  ...windows(0, 1000, 250, "Classical & early medieval"),
  ...windows(1000, 1500, 100, "Medieval"),
  ...windows(1500, 1800, 50, "Early modern"),
  ...windows(1800, 2030, 10, "Modern"),
];

export const AGES = [...new Set(ERAS.map((e) => e.age))];

export function eraOf(year: number): Era {
  return ERAS.find((e) => year >= e.from && year < e.to) ?? ERAS[ERAS.length - 1]!;
}
