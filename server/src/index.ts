import { Hono } from "hono";
import { cors } from "hono/cors";
import { completeJSON } from "./openrouter.ts";
import { createJsonObjectStream } from "./jsonStream.ts";
import {
  clampN,
  describeEvent,
  normalizeStrength,
  renderEventPrompt,
  sanitizeContext,
  sanitizeEvent,
  sanitizeItem,
  sanitizeList,
  type Event,
  type Strength,
} from "./helpers.ts";
import {
  seedSystemPrompt,
  enrichEventSystemPrompt,
  effectsSystemPrompt,
  causesSystemPrompt,
  bridgeSystemPrompt,
  exploreSystemPrompt,
  pathSystemPrompt,
  explainSystemPrompt,
} from "./prompts.ts";

export const app = new Hono();

app.use("/api/*", cors({ origin: "*" }));

app.get("/", (c) =>
  c.text("history-effects API. POST /api/{explore,seed,effects,causes,path,explain,bridge,enrich}[/stream]")
);

class BadOutput extends Error {
  constructor(message: string, readonly raw: unknown) {
    super(message);
  }
}

type Prompt = { system: string; user: string; temperature?: number; webSearch?: boolean };

type Task<B> = {
  label: string;
  // Returns the parsed body, or an error message for a 400.
  parse: (body: Record<string, unknown>) => B | string;
  prompt: (body: B) => Prompt;
  finish: (raw: unknown, body: B) => unknown;
  // Validates one streamed object; return null to drop it.
  item?: (key: string, value: unknown, body: B) => unknown | null;
};

type Emit = (event: string, data: unknown) => void;

async function runTask<B>(task: Task<B>, body: B, emit?: Emit) {
  const p = task.prompt(body);
  const counts = new Map<string, number>();
  const objects = createJsonObjectStream((key, value) => {
    const clean = task.item?.(key, value, body);
    if (!clean) return;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    emit?.("item", { key, index, value: clean });
  });
  const raw = await completeJSON<unknown>({
    systemPrompt: p.system,
    userPrompt: p.user,
    temperature: p.temperature,
    webSearch: p.webSearch,
    label: task.label,
    onToken: emit
      ? (token) => {
          emit("token", { token });
          objects.feed(token);
        }
      : undefined,
    onReasoning: emit ? (text) => emit("thinking", { text }) : undefined,
  });
  return task.finish(raw, body);
}

function sseResponse(producer: (emit: Emit) => Promise<unknown>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Emit = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("result", await producer(send));
      } catch (e) {
        send("error", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

async function readBody(req: { json: () => Promise<unknown> }): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function register<B>(path: string, task: Task<B>) {
  app.post(path, async (c) => {
    const body = task.parse(await readBody(c.req));
    if (typeof body === "string") return c.json({ error: body }, 400);
    try {
      return c.json(await runTask(task, body) as Record<string, unknown>);
    } catch (e) {
      if (e instanceof BadOutput) return c.json({ error: e.message, raw: e.raw }, 502);
      throw e;
    }
  });

  app.post(`${path}/stream`, async (c) => {
    const body = task.parse(await readBody(c.req));
    if (typeof body === "string") return c.json({ error: body }, 400);
    return sseResponse((emit) => runTask(task, body, emit));
  });
}

// --- body parsing -------------------------------------------------------------

const asEvent = (v: unknown): Event | null => sanitizeEvent(v);

function requireEvent(body: Record<string, unknown>, key: string): Event | string {
  return asEvent(body[key]) ?? `${key}.title is required`;
}

// Accepts either an event record or a free-text phrase.
function eventOrPhrase(v: unknown): Event | string | null {
  if (typeof v === "string") return v.trim() || null;
  return asEvent(v);
}

const renderEndpoint = (v: Event | string) => (typeof v === "string" ? `Phrase: ${v}` : describeEvent(v));

function requireValidEvent(raw: unknown, key = "event"): Event {
  const event = sanitizeEvent((raw as Record<string, unknown> | null)?.[key]);
  if (!event || !event.description) throw new BadOutput("Model did not return a valid event", raw);
  return event;
}

// --- tasks --------------------------------------------------------------------

register<{ text: string }>("/api/seed", {
  label: "seed",
  parse: (b) => {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    return text ? { text } : "text is required";
  },
  prompt: ({ text }) => ({ system: seedSystemPrompt, user: `Phrase: ${text}`, temperature: 0.2 }),
  finish: (raw) => ({ event: requireValidEvent(raw) }),
  item: (key, value) => (key === "event" ? sanitizeEvent(value) : null),
});

register<{ text: string; n: number }>("/api/explore", {
  label: "explore",
  parse: (b) => {
    const text = typeof b.text === "string" ? b.text.trim() : "";
    return text ? { text, n: clampN(b.n, 5) } : "text is required";
  },
  prompt: ({ text, n }) => ({
    system: exploreSystemPrompt,
    user: `Phrase: ${text}\n\nGive the event, its ${n} most significant effects, then its ${Math.max(2, n - 2)} most significant causes.`,
    temperature: 0.3,
  }),
  finish: (raw, { n }) => {
    const r = raw as Record<string, unknown> | null;
    return {
      event: requireValidEvent(raw),
      effects: sanitizeList(r?.effects, n),
      causes: sanitizeList(r?.causes, n),
    };
  },
  item: (key, value) => (key === "event" ? sanitizeEvent(value) : key === "effects" || key === "causes" ? sanitizeItem(value) : null),
});

register<{ event: Event }>("/api/enrich", {
  label: "enrich",
  parse: (b) => {
    const event = requireEvent(b, "event");
    return typeof event === "string" ? event : { event };
  },
  prompt: ({ event }) => ({
    system: enrichEventSystemPrompt,
    user: renderEventPrompt(event, "Verify and enrich this event record."),
    temperature: 0.2,
    webSearch: true,
  }),
  finish: (raw) => ({ event: requireValidEvent(raw) }),
});

type ExpandBody = { event: Event; n: number; context: ReturnType<typeof sanitizeContext> };

function expandTask(kind: "effects" | "causes"): Task<ExpandBody> {
  const instruction =
    kind === "effects"
      ? (n: number) => `Generate the ${n} most significant downstream effects, most important first.`
      : (n: number) => `Generate the ${n} most significant upstream causes, most important first.`;
  return {
    label: kind,
    parse: (b) => {
      const event = requireEvent(b, "event");
      if (typeof event === "string") return event;
      return { event, n: clampN(b.n, 5), context: sanitizeContext(b.context) };
    },
    prompt: ({ event, n, context }) => ({
      system: kind === "effects" ? effectsSystemPrompt : causesSystemPrompt,
      user: renderEventPrompt(event, instruction(n), context),
    }),
    finish: (raw, { n }) => ({ [kind]: sanitizeList((raw as Record<string, unknown> | null)?.[kind], n) }),
    item: (key, value) => (key === kind ? sanitizeItem(value) : null),
  };
}

register("/api/effects", expandTask("effects"));
register("/api/causes", expandTask("causes"));

type PathBody = { from: Event | string; to: Event | string };

const VERDICTS = ["strong", "moderate", "weak", "none"] as const;

register<PathBody>("/api/path", {
  label: "path",
  parse: (b) => {
    const from = eventOrPhrase(b.from);
    const to = eventOrPhrase(b.to);
    return from && to ? { from, to } : "from and to are required";
  },
  prompt: ({ from, to }) => ({
    system: pathSystemPrompt,
    user: `FROM:\n${renderEndpoint(from)}\n\nTO:\n${renderEndpoint(to)}\n\nTrace the causal chain from FROM to TO.`,
    temperature: 0.3,
  }),
  finish: (raw, body) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const final = (r.final ?? {}) as Record<string, unknown>;
    const fallback = (v: Event | string) => (typeof v === "string" ? { title: v, description: "" } : v);
    return {
      from: sanitizeEvent(r.from) ?? fallback(body.from),
      to: sanitizeEvent(r.to) ?? fallback(body.to),
      steps: sanitizeList(r.steps, 6),
      final: { strength: normalizeStrength(final.strength), reasoning: String(final.reasoning ?? "").trim() },
      verdict: VERDICTS.find((v) => v === r.verdict) ?? "moderate",
      summary: String(r.summary ?? "").trim(),
    };
  },
  item: (key, value) => {
    if (key === "from" || key === "to") return sanitizeEvent(value);
    if (key === "steps") return sanitizeItem(value);
    return null;
  },
});

type ExplainBody = { cause: Event; effect: Event; reasoning: string };

const CERTAINTIES = ["consensus", "debated", "speculative"] as const;

register<ExplainBody>("/api/explain", {
  label: "explain",
  parse: (b) => {
    const cause = asEvent(b.cause);
    const effect = asEvent(b.effect);
    if (!cause || !effect) return "cause.title and effect.title are required";
    return { cause, effect, reasoning: typeof b.reasoning === "string" ? b.reasoning : "" };
  },
  prompt: ({ cause, effect, reasoning }) => ({
    system: explainSystemPrompt,
    user: `CAUSE:\n${describeEvent(cause)}\n\nEFFECT:\n${describeEvent(effect)}\n\nClaimed connection: ${reasoning || "(none given)"}\n\nExplain this connection in depth.`,
    temperature: 0.3,
  }),
  finish: (raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const mechanism = String(r.mechanism ?? "").trim();
    if (!mechanism) throw new BadOutput("Model did not return an explanation", raw);
    return {
      mechanism,
      keyFactors: Array.isArray(r.keyFactors) ? r.keyFactors.filter((f): f is string => typeof f === "string").slice(0, 5) : [],
      certainty: CERTAINTIES.find((c) => c === r.certainty) ?? "debated",
      debate: String(r.debate ?? "").trim(),
      counterfactual: String(r.counterfactual ?? "").trim(),
    };
  },
});

type BridgeBody = { from: Event; to: Event };

register<BridgeBody>("/api/bridge", {
  label: "bridge",
  parse: (b) => {
    const from = asEvent(b.from);
    const to = asEvent(b.to);
    return from && to ? { from, to } : "from.title and to.title are required";
  },
  prompt: ({ from, to }) => ({
    system: bridgeSystemPrompt,
    user:
      `EVENT_FROM (earlier):\n${describeEvent(from)}\n\n` +
      `EVENT_TO (later):\n${describeEvent(to)}\n\n` +
      `Find a significant intermediate event that bridges them.`,
  }),
  finish: (raw) => {
    const r = (raw ?? {}) as { intermediate?: unknown; fromStrength?: Strength; toStrength?: Strength; reasoning?: unknown };
    return {
      intermediate: sanitizeEvent(r.intermediate),
      fromStrength: normalizeStrength(r.fromStrength),
      toStrength: normalizeStrength(r.toStrength),
      reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    };
  },
});

app.onError((err, c) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
});

const port = Number(process.env.PORT || 3000);

if (import.meta.main) {
  const mode = process.env.MOCK_LLM === "1" ? " (MOCK_LLM: canned responses, no API calls)" : "";
  console.log(`history-effects API listening on http://localhost:${port}${mode}`);
}

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255,
};
