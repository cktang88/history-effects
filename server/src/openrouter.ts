// OpenRouter client wrapper. Returns parsed JSON from the model while keeping
// request defaults in one place for the API server and CLI.

import { OpenRouter } from "@openrouter/sdk";
import type { ChatRequest, ChatResult, ChatStreamChunk } from "@openrouter/sdk/models";

type CompletionOptions = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  label?: string;
  webSearch?: boolean;
  onToken?: (token: string) => void;
};

const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS) || 180_000;

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
    ...(opts.webSearch ? { plugins: [{ id: "web" }] } : {}),
  };

  const tag = opts.label ? `[${opts.label}] ` : "";
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
    content = opts.onToken
      ? await readStreamingContent(await client.chat.send({ chatRequest: { ...chatRequest, stream: true } }), opts.onToken)
      : readCompletionContent(await client.chat.send({ chatRequest: { ...chatRequest, stream: false } }));
  } catch (e) {
    if (tick) clearInterval(tick);
    if (tty) process.stderr.write("\n");
    throw e;
  }
  if (tick) clearInterval(tick);
  if (tty) process.stderr.write("\n");
  process.stderr.write(`${tag}done in ${Math.round((Date.now() - started) / 1000)}s\n`);

  if (!content) {
    throw new Error("OpenRouter returned no content");
  }

  return parseJSONLoose<T>(content);
}

function readCompletionContent(result: ChatResult): string | undefined {
  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : undefined;
}

async function readStreamingContent(stream: AsyncIterable<ChatStreamChunk>, onToken: (token: string) => void): Promise<string> {
  let content = "";

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta.content;
    if (!token) continue;
    content += token;
    onToken(token);
  }

  return content;
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
