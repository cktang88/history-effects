// Minimal OpenRouter client. Returns parsed JSON from the model.
// Uses chat/completions with response_format json_object when possible, plus a
// defensive fallback that extracts the first JSON object from the text.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Message = { role: "system" | "user" | "assistant"; content: string };

type CompletionOptions = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
};

export async function completeJSON<T = unknown>(opts: CompletionOptions): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Copy server/.env.example to server/.env and add your key.");
  }
  const model = process.env.OPENROUTER_MODEL || "moonshotai/kimi-k2.6";

  const messages: Message[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    response_format: { type: "json_object" as const },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      // OpenRouter recommends these for analytics; harmless if app isn't published.
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "History Effects",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenRouter returned no content: ${JSON.stringify(data)}`);
  }

  return parseJSONLoose<T>(content);
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
