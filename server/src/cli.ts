#!/usr/bin/env bun
// CLI for exercising the LLM endpoints directly without the frontend.
// Usage:
//   bun run cli seed    "<text>"
//   bun run cli effects "<title>" [--n 5]
//   bun run cli causes  "<title>" [--n 5]
//   bun run cli bridge  "<from>" "<to>"
//   bun run cli all     "<text>"

import { completeJSON } from "./openrouter.ts";
import {
  clampN,
  normalizeStrength,
  renderEventPrompt,
  sanitizeList,
  type CausalItem,
  type Event,
  type Strength,
} from "./helpers.ts";
import {
  bridgeSystemPrompt,
  causesSystemPrompt,
  effectsSystemPrompt,
  seedSystemPrompt,
} from "./prompts.ts";

export type CliCommand =
  | { kind: "seed"; text: string }
  | { kind: "effects"; title: string; n: number }
  | { kind: "causes"; title: string; n: number }
  | { kind: "bridge"; from: string; to: string }
  | { kind: "all"; text: string; n: number };

export type LlmFns = {
  seed: (text: string) => Promise<Event>;
  effects: (event: Event, n: number) => Promise<CausalItem[]>;
  causes: (event: Event, n: number) => Promise<CausalItem[]>;
  bridge: (from: Event, to: Event) => Promise<BridgeResult>;
};

export type BridgeResult = {
  intermediate: Event | null;
  fromStrength: Strength;
  toStrength: Strength;
  reasoning: string;
};

export const USAGE = `Usage:
  bun run cli seed    "<text>"
  bun run cli effects "<title>" [--n 5]
  bun run cli causes  "<title>" [--n 5]
  bun run cli bridge  "<from>" "<to>"
  bun run cli all     "<text>" [--n 5]`;

export function parseArgs(argv: string[]): CliCommand {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new Error(`Missing command.\n${USAGE}`);
  const positional = stripFlag(rest, "--n");
  const n = readN(rest);

  switch (cmd) {
    case "seed":
      return { kind: "seed", text: requireArg(positional[0], "text") };
    case "effects":
      return { kind: "effects", title: requireArg(positional[0], "title"), n };
    case "causes":
      return { kind: "causes", title: requireArg(positional[0], "title"), n };
    case "bridge":
      return {
        kind: "bridge",
        from: requireArg(positional[0], "from title"),
        to: requireArg(positional[1], "to title"),
      };
    case "all":
      return { kind: "all", text: requireArg(positional[0], "text"), n };
    default:
      throw new Error(`Unknown command: ${cmd}\n${USAGE}`);
  }
}

function readN(rest: string[]): number {
  const i = rest.indexOf("--n");
  return i === -1 ? 5 : clampN(Number(rest[i + 1]), 5);
}

function stripFlag(rest: string[], flag: string): string[] {
  const i = rest.indexOf(flag);
  if (i === -1) return rest;
  return [...rest.slice(0, i), ...rest.slice(i + 2)];
}

function requireArg<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing required argument: ${name}\n${USAGE}`);
  }
  return v;
}

const eventFromTitle = (title: string): Event => ({ title, description: "" });

export async function runCommand(cmd: CliCommand, fns: LlmFns): Promise<Record<string, unknown>> {
  switch (cmd.kind) {
    case "seed":
      return { seed: await fns.seed(cmd.text) };
    case "effects":
      return { effects: await fns.effects(eventFromTitle(cmd.title), cmd.n) };
    case "causes":
      return { causes: await fns.causes(eventFromTitle(cmd.title), cmd.n) };
    case "bridge":
      return { bridge: await fns.bridge(eventFromTitle(cmd.from), eventFromTitle(cmd.to)) };
    case "all": {
      const event = await fns.seed(cmd.text);
      const [effects, causes] = await Promise.all([fns.effects(event, cmd.n), fns.causes(event, cmd.n)]);
      return { seed: event, effects, causes };
    }
  }
}

// --- Real LLM-backed implementations of LlmFns ---

const seed: LlmFns["seed"] = async (text) => {
  const result = await completeJSON<{ event: Event }>({
    systemPrompt: seedSystemPrompt,
    userPrompt: `Phrase: ${text}`,
    temperature: 0.2,
    label: "seed",
    onToken: streamCliToken,
  });
  if (!result?.event?.title) throw new Error(`bad seed result: ${JSON.stringify(result)}`);
  return result.event;
};

const effects: LlmFns["effects"] = async (event, n) => {
  const result = await completeJSON<{ effects: unknown }>({
    systemPrompt: effectsSystemPrompt,
    userPrompt: renderEventPrompt(event, `Generate the ${n} most significant downstream effects.`),
    label: "effects",
    onToken: streamCliToken,
  });
  return sanitizeList(result?.effects, n);
};

const causes: LlmFns["causes"] = async (event, n) => {
  const result = await completeJSON<{ causes: unknown }>({
    systemPrompt: causesSystemPrompt,
    userPrompt: renderEventPrompt(event, `Generate the ${n} most significant upstream causes.`),
    label: "causes",
    onToken: streamCliToken,
  });
  return sanitizeList(result?.causes, n);
};

const bridge: LlmFns["bridge"] = async (from, to) => {
  const result = await completeJSON<BridgeResult>({
    systemPrompt: bridgeSystemPrompt,
    userPrompt:
      `EVENT_FROM (earlier):\nTitle: ${from.title}\nDescription: ${from.description ?? ""}\n\n` +
      `EVENT_TO (later):\nTitle: ${to.title}\nDescription: ${to.description ?? ""}\n\n` +
      `Find a significant intermediate event that bridges them.`,
    label: "bridge",
    onToken: streamCliToken,
  });
  return {
    intermediate: result?.intermediate ?? null,
    fromStrength: normalizeStrength(result?.fromStrength),
    toStrength: normalizeStrength(result?.toStrength),
    reasoning: typeof result?.reasoning === "string" ? result.reasoning : "",
  };
};

export const llmFns: LlmFns = { seed, effects, causes, bridge };

function streamCliToken(token: string) {
  process.stderr.write(token);
}

if (import.meta.main) {
  try {
    const cmd = parseArgs(process.argv.slice(2));
    const out = await runCommand(cmd, llmFns);
    process.stderr.write("\n");
    for (const [k, v] of Object.entries(out)) {
      console.log(`\n=== ${k} ===`);
      console.log(JSON.stringify(v, null, 2));
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
