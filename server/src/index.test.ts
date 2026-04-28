import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { app } from "./index.ts";

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
