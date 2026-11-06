import { describe, expect, it } from "vitest";
import { regionFromCoord, regionOf } from "./regions.ts";

const cases: [string, number, number, string][] = [
  ["Paris", 48.86, 2.35, "Europe"],
  ["Istanbul", 41.01, 28.97, "Europe"],
  ["Baghdad", 33.31, 44.36, "Middle East & North Africa"],
  ["Cairo", 30.04, 31.24, "Middle East & North Africa"],
  ["Carthage", 36.85, 10.32, "Europe"],
  ["Marrakesh", 31.63, -8.0, "Middle East & North Africa"],
  ["Lagos", 6.52, 3.38, "Sub-Saharan Africa"],
  ["Aksum", 14.13, 38.72, "Sub-Saharan Africa"],
  ["Timbuktu", 16.77, -3.0, "Sub-Saharan Africa"],
  ["Sanaa", 15.37, 44.19, "Middle East & North Africa"],
  ["Khartoum", 15.5, 32.56, "Middle East & North Africa"],
  ["Moscow", 55.75, 37.62, "Europe"],
  ["Samarkand", 39.65, 66.96, "Russia & Central Asia"],
  ["Novosibirsk", 55.0, 82.9, "Russia & Central Asia"],
  ["Delhi", 28.61, 77.21, "South Asia"],
  ["Kabul", 34.53, 69.17, "South Asia"],
  ["Beijing", 39.9, 116.4, "East Asia"],
  ["Tokyo", 35.68, 139.69, "East Asia"],
  ["Hanoi", 21.03, 105.85, "East Asia"],
  ["Jakarta", -6.2, 106.85, "Southeast Asia"],
  ["Sydney", -33.87, 151.21, "Oceania"],
  ["New York", 40.71, -74.0, "North America"],
  ["Mexico City", 19.43, -99.13, "Latin America"],
  ["Havana", 23.11, -82.37, "Latin America"],
  ["Anchorage", 61.2, -149.9, "North America"],
  ["Cusco", -13.53, -71.97, "Latin America"],
  ["Honolulu", 21.3, -157.86, "Oceania"],
];

describe("regionFromCoord", () => {
  it.each(cases)("%s", (_name, lat, lon, region) => {
    expect(regionFromCoord(lat, lon)).toBe(region);
  });
});

describe("regionOf", () => {
  it("trusts countries over a coordinate on another continent", () => {
    expect(regionOf([28.1, -15.4], ["Q46"])).toBe("Europe"); // Canary Islands coordinate, Spanish war
    expect(regionOf([28.6, 77.2], ["Q48"])).toBe("South Asia");
  });

  it("falls back to continents, and calls multi-continent entities global", () => {
    expect(regionOf(undefined, ["Q46"])).toBe("Europe");
    expect(regionOf(undefined, ["Q46", "Q48", "Q49"])).toBe("Global");
    expect(regionOf(undefined, [])).toBe("Global");
  });
});
