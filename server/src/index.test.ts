import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app, coalesce } from "./index.ts";

// Helpers ---------------------------------------------------------------------

function mockOpenRouterContent(content: unknown) {
  const stringified = typeof content === "string" ? content : JSON.stringify(content);
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "gen-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          system_fingerprint: null,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: stringified },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
}

function mockOpenRouterStream(chunks: string[]) {
  return vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      )
  );
}

function jsonReq(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// /api/seed -------------------------------------------------------------------

describe("POST /api/seed", () => {
  it("returns the cleaned event from the model", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        event: { title: "Seven Years' War (1756–1763)", description: "Global conflict." },
      })
    );
    const res = await jsonReq("/api/seed", { text: "seven years war" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: { title: string; description: string } };
    expect(json.event.title).toMatch(/Seven Years/);
    expect(json.event.description).toBe("Global conflict.");
  });

  it("400s without text", async () => {
    const res = await jsonReq("/api/seed", {});
    expect(res.status).toBe(400);
  });

  it("400s with whitespace-only text", async () => {
    const res = await jsonReq("/api/seed", { text: "   " });
    expect(res.status).toBe(400);
  });

  it("502s when model returns malformed event", async () => {
    vi.stubGlobal("fetch", mockOpenRouterContent({ event: { title: "" } }));
    const res = await jsonReq("/api/seed", { text: "x" });
    expect(res.status).toBe(502);
  });
});

// /api/enrich -----------------------------------------------------------------

describe("POST /api/enrich", () => {
  it("returns a web-enriched event", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        event: { title: "French Revolution (1789–1799)", description: "Detailed account." },
      })
    );
    const res = await jsonReq("/api/enrich", {
      event: { title: "French Revolution", description: "" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: { title: string; description: string } };
    expect(json.event.title).toMatch(/French Revolution/);
    expect(json.event.description).toBe("Detailed account.");
  });

  it("400s without event.title", async () => {
    const res = await jsonReq("/api/enrich", { event: { description: "x" } });
    expect(res.status).toBe(400);
  });

  it("502s when model returns malformed event", async () => {
    vi.stubGlobal("fetch", mockOpenRouterContent({ event: { title: "" } }));
    const res = await jsonReq("/api/enrich", {
      event: { title: "X", description: "" },
    });
    expect(res.status).toBe(502);
  });
});

// /api/effects ----------------------------------------------------------------

describe("POST /api/effects", () => {
  it("returns sanitized effects", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        effects: [
          { title: " Stamp Act of 1765 ", description: "Tax", strength: "primary", reasoning: "r" },
          { title: "Pontiac's Rebellion", description: "War", strength: "weird", reasoning: "" },
        ],
      })
    );
    const res = await jsonReq("/api/effects", {
      event: { title: "Seven Years' War", description: "..." },
      n: 5,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { effects: { title: string; strength: string }[] };
    expect(json.effects).toHaveLength(2);
    expect(json.effects[0]?.title).toBe("Stamp Act of 1765");
    expect(json.effects[0]?.strength).toBe("primary");
    expect(json.effects[1]?.strength).toBe("contributing"); // normalized from "weird"
  });

  it("respects the n cap", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `t${i}`,
      description: "",
      strength: "primary",
      reasoning: "",
    }));
    vi.stubGlobal("fetch", mockOpenRouterContent({ effects: items }));
    const res = await jsonReq("/api/effects", {
      event: { title: "X", description: "" },
      n: 3,
    });
    const json = (await res.json()) as { effects: unknown[] };
    expect(json.effects).toHaveLength(3);
  });

  it("400s without event.title", async () => {
    const res = await jsonReq("/api/effects", { event: { description: "x" } });
    expect(res.status).toBe(400);
  });

  it("returns [] when model returns non-array", async () => {
    vi.stubGlobal("fetch", mockOpenRouterContent({ effects: "broken" }));
    const res = await jsonReq("/api/effects", {
      event: { title: "X", description: "" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { effects: unknown[] };
    expect(json.effects).toEqual([]);
  });
});

describe("POST /api/effects/stream", () => {
  it("streams tokens and final sanitized effects", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterStream([
        'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":null,"delta":{"content":"{\\"effects\\":["}}]}\n\n',
        'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":null,"delta":{"content":"{\\"title\\":\\"T\\",\\"description\\":\\"D\\",\\"strength\\":\\"primary\\",\\"reasoning\\":\\"R\\"}]}"}}]}\n\n',
        'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":"stop","delta":{}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );

    const res = await jsonReq("/api/effects/stream?tokens=1", {
      event: { title: "X", description: "" },
      n: 1,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: token");
    expect(text).toContain("event: result");
    expect(text).toContain('"effects":[{"title":"T"');
  });
});

// /api/causes -----------------------------------------------------------------

describe("POST /api/causes", () => {
  it("returns sanitized causes", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        causes: [
          {
            title: "Diplomatic Revolution of 1756",
            description: "Realignment.",
            strength: "primary",
            reasoning: "Set up the war's coalitions.",
          },
        ],
      })
    );
    const res = await jsonReq("/api/causes", {
      event: { title: "Seven Years' War", description: "" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { causes: { title: string }[] };
    expect(json.causes[0]?.title).toBe("Diplomatic Revolution of 1756");
  });

  it("400s without event.title", async () => {
    const res = await jsonReq("/api/causes", {});
    expect(res.status).toBe(400);
  });
});

// /api/bridge -----------------------------------------------------------------

describe("POST /api/bridge", () => {
  it("returns intermediate + both leg strengths", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        intermediate: {
          title: "Stamp Act Crisis (1765)",
          description: "Colonial backlash to direct taxation.",
        },
        fromStrength: "primary",
        toStrength: "contributing",
        reasoning: "War debt → Stamp Act → Revolution.",
      })
    );
    const res = await jsonReq("/api/bridge", {
      from: { title: "Seven Years' War", description: "" },
      to: { title: "American Revolution", description: "" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      intermediate: { title: string } | null;
      fromStrength: string;
      toStrength: string;
      reasoning: string;
    };
    expect(json.intermediate?.title).toBe("Stamp Act Crisis (1765)");
    expect(json.fromStrength).toBe("primary");
    expect(json.toStrength).toBe("contributing");
    expect(json.reasoning).toMatch(/Stamp Act/);
  });

  it("returns intermediate=null when model finds no link", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        intermediate: null,
        fromStrength: "minor",
        toStrength: "minor",
        reasoning: "No plausible historical link.",
      })
    );
    const res = await jsonReq("/api/bridge", {
      from: { title: "A", description: "" },
      to: { title: "B", description: "" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { intermediate: unknown };
    expect(json.intermediate).toBeNull();
  });

  it("normalizes garbage strengths to 'contributing'", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        intermediate: { title: "Mid", description: "M" },
        fromStrength: "huge",
        toStrength: 42,
        reasoning: "...",
      })
    );
    const res = await jsonReq("/api/bridge", {
      from: { title: "A", description: "" },
      to: { title: "B", description: "" },
    });
    const json = (await res.json()) as { fromStrength: string; toStrength: string };
    expect(json.fromStrength).toBe("contributing");
    expect(json.toStrength).toBe("contributing");
  });

  it("400s without both events", async () => {
    const res = await jsonReq("/api/bridge", { from: { title: "A", description: "" } });
    expect(res.status).toBe(400);
  });
});

// Error path ------------------------------------------------------------------

function sseChunk(content: string) {
  return `data: ${JSON.stringify({
    id: "gen",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function streamOf(doc: unknown) {
  const text = JSON.stringify(doc);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 9) chunks.push(sseChunk(text.slice(i, i + 9)));
  return mockOpenRouterStream([...chunks, "data: [DONE]\n\n"]);
}

function parseEvents(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => ({
      event: block.match(/^event: (.+)$/m)?.[1],
      data: JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? "null"),
    }));
}

describe("POST /api/explore/stream", () => {
  it("omits raw token events unless asked", async () => {
    vi.stubGlobal("fetch", streamOf({ event: { title: "T", year: 1, description: "d" }, effects: [], causes: [] }));
    const res = await jsonReq("/api/explore/stream", { text: "t" });
    expect(parseEvents(await res.text()).some((e) => e.event === "token")).toBe(false);
  });

  it("streams the event and each effect/cause as separate item events", async () => {
    vi.stubGlobal(
      "fetch",
      streamOf({
        event: { title: "Black Death", year: 1347, description: "Plague." },
        effects: [
          { title: "Peasants' Revolt", year: 1381, description: "d", strength: "contributing", reasoning: "r" },
          { title: "Statute of Labourers", year: 1351, description: "d", strength: "bogus", reasoning: "r" },
        ],
        causes: [{ title: "Siege of Caffa", year: 1346, description: "d", strength: "primary", reasoning: "r" }],
      })
    );
    const res = await jsonReq("/api/explore/stream", { text: "black death" });
    const events = parseEvents(await res.text());
    const items = events.filter((e) => e.event === "item").map((e) => [e.data.key, e.data.index, e.data.value.title]);
    expect(items).toEqual([
      ["event", 0, "Black Death"],
      ["effects", 0, "Peasants' Revolt"],
      ["effects", 1, "Statute of Labourers"],
      ["causes", 0, "Siege of Caffa"],
    ]);
    const result = events.find((e) => e.event === "result")!.data;
    expect(result.effects[1].strength).toBe("contributing");
    expect(result.event.year).toBe(1347);
  });

  it("400s without text", async () => {
    const res = await jsonReq("/api/explore/stream", { text: " " });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/effects context", () => {
  it("sends the exploration path and excluded titles to the model", async () => {
    const fetchMock = mockOpenRouterContent({ effects: [] });
    vi.stubGlobal("fetch", fetchMock);
    await jsonReq("/api/effects", {
      event: { title: "Printing press", description: "d" },
      n: 3,
      context: { path: ["Paper reaches Europe"], exclude: ["Reformation"] },
    });
    const request = fetchMock.mock.calls[0] as unknown as [Request | string, RequestInit | undefined];
    const body = request[0] instanceof Request ? await request[0].text() : String(request[1]?.body);
    expect(body).toContain("Paper reaches Europe → [this event]");
    expect(body).toContain("do NOT repeat");
    expect(body).toContain("- Reformation");
  });
});

describe("POST /api/path", () => {
  it("accepts phrases and returns a sanitized chain", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        from: { title: "Black Death", year: 1347, description: "d" },
        to: { title: "Reformation", year: 1517, description: "d" },
        steps: [{ title: "Serfdom collapses", year: 1350, description: "d", strength: "primary", reasoning: "r" }],
        final: { strength: "minor", reasoning: "f" },
        verdict: "weird",
        summary: "s",
      })
    );
    const res = await jsonReq("/api/path", { from: "black death", to: "reformation" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, any>;
    expect(json.steps).toHaveLength(1);
    expect(json.final).toEqual({ strength: "minor", reasoning: "f" });
    expect(json.verdict).toBe("moderate");
  });

  it("400s without both endpoints", async () => {
    const res = await jsonReq("/api/path", { from: "x" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/explain", () => {
  it("returns a structured explanation", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenRouterContent({
        mechanism: "m",
        keyFactors: ["a", 3, "b"],
        certainty: "consensus",
        debate: "d",
        counterfactual: "c",
      })
    );
    const res = await jsonReq("/api/explain", {
      cause: { title: "A", description: "" },
      effect: { title: "B", description: "" },
      reasoning: "r",
    });
    const json = (await res.json()) as Record<string, any>;
    expect(json).toEqual({ mechanism: "m", keyFactors: ["a", "b"], certainty: "consensus", debate: "d", counterfactual: "c" });
  });

  it("502s on an empty explanation", async () => {
    vi.stubGlobal("fetch", mockOpenRouterContent({ mechanism: "" }));
    const res = await jsonReq("/api/explain", { cause: { title: "A" }, effect: { title: "B" } });
    expect(res.status).toBe(502);
  });
});

describe("error handling", () => {
  it("returns 500 with friendly message when API key is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const res = await jsonReq("/api/seed", { text: "hello" });
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("coalesce", () => {
  it("batches pushes into one send per interval and flushes the rest", async () => {
    const sent: string[] = [];
    const c = coalesce((t) => sent.push(t), 20);
    c.push("a");
    c.push("b");
    await new Promise((r) => setTimeout(r, 40));
    c.push("c");
    c.flush();
    expect(sent).toEqual(["ab", "c"]);
  });
});
