import { describe, expect, it } from "vitest";
import { lensFromType } from "./01b-expand.ts";

describe("lensFromType", () => {
  it.each([
    ["battle", "battle"],
    ["siege", "battle"],
    ["war", "war"],
    ["civil war", "war"],
    ["rebellion", "revolution"],
    ["coup d'état", "revolution"],
    ["peace treaty", "treaty"],
    ["military alliance", "treaty"],
    ["intergovernmental organization", "treaty"],
    ["historical country", "state"],
    ["dynasty", "state"],
    ["religion", "idea"],
    ["political ideology", "idea"],
    ["famine", "disaster"],
    ["genocide", "atrocity"],
    ["historical period", "period"],
    ["archaeological culture", "period"],
  ])("%s → %s", (type, lens) => {
    expect(lensFromType(type, false)).toBe(lens);
  });

  it("puts people in the leader lens by default", () => {
    expect(lensFromType("human", true)).toBe("leader");
  });
});
