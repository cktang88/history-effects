import { describe, expect, it, vi } from "vitest";
import { parseArgs, runCommand, type LlmFns } from "./cli.ts";

describe("parseArgs", () => {
  it("parses seed", () => {
    expect(parseArgs(["seed", "Sputnik"])).toEqual({ kind: "seed", text: "Sputnik" });
  });

  it("parses effects with default n", () => {
    expect(parseArgs(["effects", "Sputnik"])).toEqual({ kind: "effects", title: "Sputnik", n: 5 });
  });

  it("parses effects with --n", () => {
    expect(parseArgs(["effects", "Sputnik", "--n", "3"])).toEqual({
      kind: "effects",
      title: "Sputnik",
      n: 3,
    });
  });

  it("clamps --n into [1,8]", () => {
    expect(parseArgs(["effects", "x", "--n", "99"]).kind === "effects" && parseArgs(["effects", "x", "--n", "99"])).toMatchObject({ n: 8 });
    expect(parseArgs(["effects", "x", "--n", "0"])).toMatchObject({ n: 1 });
  });

  it("strips --n from positional args (flag can come before title)", () => {
    expect(parseArgs(["causes", "--n", "2", "Title"])).toEqual({
      kind: "causes",
      title: "Title",
      n: 2,
    });
  });

  it("parses bridge", () => {
    expect(parseArgs(["bridge", "A", "B"])).toEqual({ kind: "bridge", from: "A", to: "B" });
  });

  it("parses all with --n", () => {
    expect(parseArgs(["all", "Sputnik", "--n", "4"])).toEqual({
      kind: "all",
      text: "Sputnik",
      n: 4,
    });
  });

  it("throws on missing command", () => {
    expect(() => parseArgs([])).toThrow(/Missing command/);
  });

  it("throws on unknown command", () => {
    expect(() => parseArgs(["nope", "x"])).toThrow(/Unknown command/);
  });

  it("throws on missing positional", () => {
    expect(() => parseArgs(["seed"])).toThrow(/Missing required argument/);
    expect(() => parseArgs(["bridge", "only-one"])).toThrow(/Missing required argument/);
  });
});

describe("runCommand", () => {
  const event = { title: "Seeded", description: "desc" };
  const item = { title: "Eff", description: "d", strength: "primary" as const, reasoning: "r" };
  const bridgeResult = {
    intermediate: { title: "Mid", description: "m" },
    fromStrength: "primary" as const,
    toStrength: "contributing" as const,
    reasoning: "because",
  };

  const makeFns = (): LlmFns => ({
    seed: vi.fn(async () => event),
    effects: vi.fn(async () => [item]),
    causes: vi.fn(async () => [item]),
    bridge: vi.fn(async () => bridgeResult),
  });

  it("runs seed", async () => {
    const fns = makeFns();
    const out = await runCommand({ kind: "seed", text: "x" }, fns);
    expect(out).toEqual({ seed: event });
    expect(fns.seed).toHaveBeenCalledWith("x");
  });

  it("runs effects with derived event", async () => {
    const fns = makeFns();
    const out = await runCommand({ kind: "effects", title: "T", n: 3 }, fns);
    expect(out).toEqual({ effects: [item] });
    expect(fns.effects).toHaveBeenCalledWith({ title: "T", description: "" }, 3);
  });

  it("runs causes", async () => {
    const fns = makeFns();
    const out = await runCommand({ kind: "causes", title: "T", n: 2 }, fns);
    expect(out).toEqual({ causes: [item] });
    expect(fns.causes).toHaveBeenCalledWith({ title: "T", description: "" }, 2);
  });

  it("runs bridge", async () => {
    const fns = makeFns();
    const out = await runCommand({ kind: "bridge", from: "A", to: "B" }, fns);
    expect(out).toEqual({ bridge: bridgeResult });
    expect(fns.bridge).toHaveBeenCalledWith(
      { title: "A", description: "" },
      { title: "B", description: "" }
    );
  });

  it("runs all: seed, then effects+causes for the seeded event", async () => {
    const fns = makeFns();
    const out = await runCommand({ kind: "all", text: "x", n: 2 }, fns);
    expect(out).toEqual({ seed: event, effects: [item], causes: [item] });
    expect(fns.seed).toHaveBeenCalledWith("x");
    expect(fns.effects).toHaveBeenCalledWith(event, 2);
    expect(fns.causes).toHaveBeenCalledWith(event, 2);
  });
});
