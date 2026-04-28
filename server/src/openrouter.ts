// OpenRouter client wrapper. Returns parsed JSON from the model while keeping
// request defaults in one place for the API server and CLI.

import { OpenRouter } from "@openrouter/sdk";
import type { ChatRequest, ChatResult, ChatStreamChunk } from "@openrouter/sdk/models";
import { mkdir, writeFile } from "node:fs/promises";

type CompletionOptions = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  label?: string;
  webSearch?: boolean;
  onToken?: (token: string) => void;
};

const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 180_000;
const LOG_DIR = new URL("../logs/", import.meta.url);
const JSON_REPAIR_SYSTEM_PROMPT = `
You repair malformed JSON. Return ONLY valid JSON. Do not explain, do not use markdown, and do not add fields that are not implied by the input.
`.trim();

export async function completeJSON<T = unknown>(opts: CompletionOptions): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Copy server/.env.example to server/.env and add your key.");
  }
  const model = process.env.OPENROUTER_MODEL || "moonshotai/kimi-k2.6";
  const client = new OpenRouter({
    apiKey,
    httpReferer: "http://localhost:5173",
    appTitle: "History Effects",
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const chatRequest: ChatRequest = {
    model,
    messages: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: opts.systemPrompt,
            cacheControl: { type: "ephemeral" },
          },
        ],
      },
      { role: "user", content: opts.userPrompt },
    ],
    temperature: opts.temperature ?? 0.4,
    responseFormat: { type: "json_object" },
    reasoning: { effort: "medium" },
    cacheControl: { type: "ephemeral" },
    stream: !!opts.onToken,
    plugins: [
      ...(opts.onToken ? [] : [{ id: "response-healing" as const }]),
      ...(opts.webSearch ? [{ id: "web" as const }] : []),
    ],
  };

  const tag = opts.label ? `[${opts.label}] ` : "";
  const log = createLlmLog(opts, model, chatRequest);
  const tty = process.stderr.isTTY;
  const started = Date.now();
  const features = opts.webSearch ? "reasoning+web" : "reasoning";
  process.stderr.write(`${tag}calling ${model} (${features}${opts.onToken ? ", streaming" : ""})...\n`);
  const tick = tty
    ? setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        process.stderr.write(`\r${tag}waiting ${s}s...`);
      }, 1000)
    : null;

  let content: string | undefined;
  try {
    if (opts.onToken) {
      content = await readStreamingContent(
        await client.chat.send({ chatRequest: { ...chatRequest, stream: true } }),
        opts.onToken,
        log
      );
    } else {
      const result = await client.chat.send({ chatRequest: { ...chatRequest, stream: false } });
      log.response = result;
      log.reasoning = extractResultReasoning(result);
      content = readCompletionContent(result);
    }
  } catch (e) {
    if (tick) clearInterval(tick);
    if (tty) process.stderr.write("\n");
    log.error = serializeError(e);
    await safeWriteLlmLog(log);
    throw e;
  }
  if (tick) clearInterval(tick);
  if (tty) process.stderr.write("\n");
  process.stderr.write(`${tag}done in ${Math.round((Date.now() - started) / 1000)}s\n`);

  if (!content) {
    log.error = "OpenRouter returned no content";
    await safeWriteLlmLog(log);
    throw new Error("OpenRouter returned no content");
  }

  let parsed: T;
  try {
    parsed = parseJSONLoose<T>(content);
  } catch (e) {
    if (opts.onToken) process.stderr.write("\n");
    process.stderr.write(`${tag}repairing malformed JSON output...\n`);
    const repairLog = createLlmLog({ ...opts, label: `${opts.label ?? "completion"}-repair` }, model, null);
    const repaired = await requestJSONRepair(client, model, opts, content, repairLog);
    log.repair = {
      content: repaired,
      logFile: repairLog.file,
    };
    try {
      parsed = parseJSONLoose<T>(repaired);
      log.parsed = parsed;
      await safeWriteLlmLog(log);
      return parsed;
    } catch {
      log.error = serializeError(e);
      await safeWriteLlmLog(log);
      throw e;
    }
  }
  log.parsed = parsed;
  await safeWriteLlmLog(log);
  return parsed;
}

function readCompletionContent(result: ChatResult): string | undefined {
  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : undefined;
}

async function readStreamingContent(
  stream: AsyncIterable<ChatStreamChunk>,
  onToken: (token: string) => void,
  log: LlmLog
): Promise<string> {
  let content = "";

  for await (const chunk of stream) {
    log.streamChunks.push(chunk);
    const reasoning = extractChunkReasoning(chunk);
    if (reasoning) log.streamReasoning.push(reasoning);
    const token = chunk.choices[0]?.delta.content;
    if (!token) continue;
    content += token;
    onToken(token);
  }

  return content;
}

async function requestJSONRepair(
  client: OpenRouter,
  model: string,
  opts: CompletionOptions,
  malformedOutput: string,
  log: LlmLog
): Promise<string> {
  const chatRequest: ChatRequest = {
      model,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: JSON_REPAIR_SYSTEM_PROMPT,
              cacheControl: { type: "ephemeral" },
            },
          ],
        },
        {
          role: "user",
          content:
            `Expected output contract:\n${extractReturnContract(opts.systemPrompt)}\n\n` +
            `Malformed output to repair:\n${malformedOutput}`,
        },
      ],
      temperature: 0,
      responseFormat: { type: "json_object" },
      cacheControl: { type: "ephemeral" },
      plugins: [{ id: "response-healing" }],
      stream: false,
  };
  log.request = chatRequest;
  const result = await client.chat.send({
    chatRequest,
  }) as ChatResult;
  log.response = result;
  log.reasoning = extractResultReasoning(result);
  await safeWriteLlmLog(log);
  return readCompletionContent(result) ?? "";
}

function extractReturnContract(systemPrompt: string): string {
  const marker = "Return ONLY valid JSON";
  const start = systemPrompt.lastIndexOf(marker);
  return start === -1 ? systemPrompt : systemPrompt.slice(start);
}

type LlmLog = {
  file: string;
  startedAt: string;
  completedAt?: string;
  label?: string;
  model: string;
  request: ChatRequest | null;
  response?: ChatResult;
  streamChunks: ChatStreamChunk[];
  streamReasoning: unknown[];
  reasoning?: unknown;
  parsed?: unknown;
  repair?: {
    content: string;
    logFile: string;
  };
  error?: unknown;
};

function createLlmLog(opts: CompletionOptions, model: string, request: ChatRequest | null): LlmLog {
  const startedAt = new Date();
  const safeLabel = (opts.label ?? "completion").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  return {
    file: `${stamp}-${safeLabel}-${crypto.randomUUID()}.json`,
    startedAt: startedAt.toISOString(),
    label: opts.label,
    model,
    request,
    streamChunks: [],
    streamReasoning: [],
  };
}

async function writeLlmLog(log: LlmLog) {
  log.completedAt = new Date().toISOString();
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(new URL(log.file, LOG_DIR), JSON.stringify(log, null, 2));
}

async function safeWriteLlmLog(log: LlmLog) {
  try {
    await writeLlmLog(log);
  } catch (e) {
    console.error("failed to write LLM log", e);
  }
}

function extractResultReasoning(result: ChatResult): unknown {
  return result.choices.map((choice) => ({
    index: choice.index,
    reasoning: choice.message.reasoning,
    reasoningDetails: choice.message.reasoningDetails,
    usage: result.usage,
  }));
}

function extractChunkReasoning(chunk: ChatStreamChunk): unknown | null {
  const reasoning = chunk.choices.map((choice) => ({
    index: choice.index,
    reasoning: choice.delta.reasoning,
    reasoningDetails: choice.delta.reasoningDetails,
  }));
  return reasoning.some((item) => item.reasoning || item.reasoningDetails) ? { id: chunk.id, reasoning } : null;
}

function serializeError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  return {
    name: e.name,
    message: e.message,
    stack: e.stack,
  };
}

// Some models wrap JSON in markdown fences or add prose around it. Try strict
// parse first; if that fails, scan for the first balanced { ... } block.
export function parseJSONLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  // Strip ```json ... ``` fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {}
  }

  // Find first balanced { ... } substring
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as T;
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error(`Could not parse model output as JSON. Raw output:\n${raw}`);
}
