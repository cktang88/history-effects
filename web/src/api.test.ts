import { describe, it, expect, afterEach, vi } from "vitest";
import * as api from "./api";

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function mockSSE(chunks: string[]) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
            c.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      )
  );
}

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const effect = { title: "Reformation", description: "d", strength: "primary", reasoning: "r", year: 1517 };

describe("postStream", () => {
  it("delivers items as they arrive, then the result", async () => {
    mockLocalStorage();
    const body = sse("thinking", { text: "hmm" }) + sse("item", { key: "effects", index: 0, value: effect });
    // Split mid-event to exercise buffering across chunks.
    vi.stubGlobal("fetch", mockSSE([body.slice(0, 30), body.slice(30), sse("result", { effects: [effect] })]));

    const items: unknown[] = [];
    const thoughts: string[] = [];
    const result = await api.expand("effects", { title: "Press", description: "" }, 5, {}, {
      onItem: (key, value) => items.push([key, value]),
      onThinking: (t) => thoughts.push(t),
    });

    expect(items).toEqual([["effects", effect]]);
    expect(thoughts).toEqual(["hmm"]);
    expect(result.effects).toEqual([effect]);
  });

  it("posts to the stream endpoint with context", async () => {
    mockLocalStorage();
    const fetchMock = mockSSE([sse("result", { effects: [] })]);
    vi.stubGlobal("fetch", fetchMock);
    await api.expand("causes", { title: "X", description: "" }, 3, { path: ["A"] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/causes/stream");
    expect(JSON.parse(String(init?.body))).toEqual({ event: { title: "X", description: "" }, n: 3, context: { path: ["A"] } });
  });

  it("replays cached items without refetching", async () => {
    mockLocalStorage();
    vi.stubGlobal("fetch", mockSSE([sse("item", { key: "event", index: 0, value: { title: "T" } }), sse("result", { event: { title: "T" } })]));
    await api.explore("t");

    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const items: string[] = [];
    await api.explore("t", { onItem: (key) => items.push(key) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(items).toEqual(["event"]);
  });

  it("bypasses the cache on refresh", async () => {
    mockLocalStorage();
    vi.stubGlobal("fetch", mockSSE([sse("result", { event: { title: "T" } })]));
    await api.explore("t");
    const fetchMock = mockSSE([sse("result", { event: { title: "T2" } })]);
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.explore("t", { refresh: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(r.event.title).toBe("T2");
  });

  it("throws the server's stream error", async () => {
    mockLocalStorage();
    vi.stubGlobal("fetch", mockSSE([sse("error", { error: "model exploded" })]));
    await expect(api.explore("x")).rejects.toThrow("model exploded");
  });

  it("surfaces JSON error bodies from failed requests", async () => {
    mockLocalStorage();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "text is required" }), { status: 400 })));
    await expect(api.explore("")).rejects.toThrow("text is required");
  });

  it("errors when the stream ends without a result", async () => {
    mockLocalStorage();
    vi.stubGlobal("fetch", mockSSE([sse("thinking", { text: "..." })]));
    await expect(api.explore("x")).rejects.toThrow(/ended early/);
  });
});

describe("response cache", () => {
  it("keeps at most 150 entries, evicting the oldest", async () => {
    const store = mockLocalStorage();
    for (let i = 0; i < 160; i++) {
      vi.stubGlobal("fetch", mockSSE([sse("result", { event: { title: `T${i}` } })]));
      await api.explore(`topic ${i}`);
    }
    const cached = [...store.keys()].filter((k) => k.startsWith("history-effects:api:v2:/api"));
    expect(cached).toHaveLength(150);
    expect(cached.some((k) => k.includes("topic 0\""))).toBe(false);
    expect(cached.some((k) => k.includes("topic 159"))).toBe(true);
  });
});

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(api.stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(api.stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
