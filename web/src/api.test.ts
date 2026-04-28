import { describe, it, expect, afterEach, vi } from "vitest";
import * as api from "./api";

function mockJSON(payload: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
}

function mockSSE(events: string[]) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(events.join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
  );
}

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("seedEvent", () => {
  it("POSTs to /api/seed and returns the event", async () => {
    const fetchMock = mockJSON({ event: { title: "WW1", description: "Big war." } });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.seedEvent("the great war");
    expect(out.event.title).toBe("WW1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/seed");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: "the great war" });
  });

  it("throws on non-OK response", async () => {
    vi.stubGlobal("fetch", mockJSON({ error: "bad" }, 400));
    await expect(api.seedEvent("x")).rejects.toThrow(/\/api\/seed failed: 400/);
  });
});

describe("enrichEvent", () => {
  it("POSTs to /api/enrich and returns the enriched event", async () => {
    const fetchMock = mockJSON({ event: { title: "WW1", description: "Detailed war." } });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.enrichEvent({ title: "WW1", description: "War." });
    expect(out.event.description).toBe("Detailed war.");

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/enrich");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      event: { title: "WW1", description: "War." },
    });
  });
});

describe("generateEffects", () => {
  it("POSTs the event and n, returns effects", async () => {
    const fetchMock = mockJSON({
      effects: [{ title: "T", description: "D", strength: "primary", reasoning: "R" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.generateEffects({ title: "X", description: "Y" }, 3);
    expect(out.effects[0]?.strength).toBe("primary");

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/effects");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      event: { title: "X", description: "Y" },
      n: 3,
    });
  });

  it("defaults n to 5 when not provided", async () => {
    const fetchMock = mockJSON({ effects: [] });
    vi.stubGlobal("fetch", fetchMock);
    await api.generateEffects({ title: "X", description: "" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string).n).toBe(5);
  });

  it("caches identical requests in localStorage", async () => {
    mockLocalStorage();
    const fetchMock = mockJSON({
      effects: [{ title: "T", description: "D", strength: "primary", reasoning: "R" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.generateEffects({ title: "X", description: "Y" }, 3);
    await api.generateEffects({ description: "Y", title: "X" }, 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when refresh is requested", async () => {
    mockLocalStorage();
    const fetchMock = mockJSON({ effects: [] });
    vi.stubGlobal("fetch", fetchMock);

    await api.generateEffects({ title: "X", description: "Y" }, 3);
    await api.generateEffects({ title: "X", description: "Y" }, 3, { refresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the streaming endpoint when an onToken callback is provided", async () => {
    const fetchMock = mockSSE([
      'event: token\ndata: {"token":"{\\"effects\\":["}\n\n',
      'event: result\ndata: {"effects":[{"title":"T","description":"D","strength":"primary","reasoning":"R"}]}\n\n',
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const tokens: string[] = [];

    const out = await api.generateEffects({ title: "X", description: "Y" }, 3, {
      onToken: (token) => tokens.push(token),
    });

    expect(out.effects[0]?.title).toBe("T");
    expect(tokens).toEqual(['{"effects":[']);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/effects/stream");
    expect((init as RequestInit).headers).toMatchObject({ Accept: "text/event-stream" });
  });
});

describe("generateCauses", () => {
  it("POSTs to /api/causes", async () => {
    const fetchMock = mockJSON({
      causes: [{ title: "C", description: "D", strength: "minor", reasoning: "" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.generateCauses({ title: "X", description: "" }, 2);
    expect(out.causes[0]?.title).toBe("C");

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/causes");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      event: { title: "X", description: "" },
      n: 2,
    });
  });
});

describe("generateBridge", () => {
  it("POSTs from/to and returns intermediate + strengths", async () => {
    const fetchMock = mockJSON({
      intermediate: { title: "Mid", description: "M" },
      fromStrength: "primary",
      toStrength: "contributing",
      reasoning: "Because.",
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api.generateBridge(
      { title: "A", description: "" },
      { title: "B", description: "" }
    );
    expect(out.intermediate?.title).toBe("Mid");
    expect(out.fromStrength).toBe("primary");
    expect(out.toStrength).toBe("contributing");

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/bridge");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      from: { title: "A", description: "" },
      to: { title: "B", description: "" },
    });
  });

  it("propagates intermediate=null", async () => {
    vi.stubGlobal(
      "fetch",
      mockJSON({
        intermediate: null,
        fromStrength: "minor",
        toStrength: "minor",
        reasoning: "no link",
      })
    );
    const out = await api.generateBridge(
      { title: "A", description: "" },
      { title: "B", description: "" }
    );
    expect(out.intermediate).toBeNull();
  });
});
