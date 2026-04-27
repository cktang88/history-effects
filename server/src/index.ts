import { Hono } from "hono";
import { cors } from "hono/cors";
import { completeJSON } from "./openrouter.ts";
import {
  clampN,
  normalizeStrength,
  renderEventPrompt,
  sanitizeList,
  type Event,
  type Strength,
} from "./helpers.ts";
import {
  seedSystemPrompt,
  effectsSystemPrompt,
  causesSystemPrompt,
  bridgeSystemPrompt,
} from "./prompts.ts";

export const app = new Hono();

app.use("/api/*", cors({ origin: "*" }));

app.get("/", (c) => c.text("history-effects API. POST /api/seed | /api/effects | /api/causes | /api/bridge"));

app.post("/api/seed", async (c) => {
  const body = await c.req.json<{ text?: string }>();
  const text = (body.text || "").trim();
  if (!text) return c.json({ error: "text is required" }, 400);

  const result = await completeJSON<{ event: Event }>({
    systemPrompt: seedSystemPrompt,
    userPrompt: `Phrase: ${text}`,
    temperature: 0.2,
  });

  if (!result?.event?.title || !result?.event?.description) {
    return c.json({ error: "Model did not return a valid event", raw: result }, 502);
  }
  return c.json(result);
});

app.post("/api/effects", async (c) => {
  const body = await c.req.json<{ event?: Event; n?: number }>();
  const event = body.event;
  const n = clampN(body.n, 5);
  if (!event?.title) return c.json({ error: "event.title is required" }, 400);

  const userPrompt = renderEventPrompt(event, `Generate the ${n} most significant downstream effects.`);
  const result = await completeJSON<{ effects: unknown }>({
    systemPrompt: effectsSystemPrompt,
    userPrompt,
  });

  return c.json({ effects: sanitizeList(result?.effects, n) });
});

app.post("/api/causes", async (c) => {
  const body = await c.req.json<{ event?: Event; n?: number }>();
  const event = body.event;
  const n = clampN(body.n, 5);
  if (!event?.title) return c.json({ error: "event.title is required" }, 400);

  const userPrompt = renderEventPrompt(event, `Generate the ${n} most significant upstream causes.`);
  const result = await completeJSON<{ causes: unknown }>({
    systemPrompt: causesSystemPrompt,
    userPrompt,
  });

  return c.json({ causes: sanitizeList(result?.causes, n) });
});

app.post("/api/bridge", async (c) => {
  const body = await c.req.json<{ from?: Event; to?: Event }>();
  const { from, to } = body;
  if (!from?.title || !to?.title) {
    return c.json({ error: "from.title and to.title are required" }, 400);
  }

  const userPrompt =
    `EVENT_FROM (earlier):\nTitle: ${from.title}\nDescription: ${from.description ?? ""}\n\n` +
    `EVENT_TO (later):\nTitle: ${to.title}\nDescription: ${to.description ?? ""}\n\n` +
    `Find a significant intermediate event that bridges them.`;

  const result = await completeJSON<{
    intermediate: Event | null;
    fromStrength: Strength;
    toStrength: Strength;
    reasoning: string;
  }>({
    systemPrompt: bridgeSystemPrompt,
    userPrompt,
  });

  return c.json({
    intermediate: result?.intermediate ?? null,
    fromStrength: normalizeStrength(result?.fromStrength),
    toStrength: normalizeStrength(result?.toStrength),
    reasoning: typeof result?.reasoning === "string" ? result.reasoning : "",
  });
});

app.onError((err, c) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
});

const port = Number(process.env.PORT || 3000);

if (import.meta.main) {
  console.log(`history-effects API listening on http://localhost:${port}`);
}

export default {
  port,
  fetch: app.fetch,
};
