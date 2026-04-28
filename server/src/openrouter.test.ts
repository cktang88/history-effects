import { afterEach, describe, it, expect, vi } from "vitest";
import { completeJSON, parseJSONLoose } from "./openrouter.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseJSONLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJSONLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON with surrounding whitespace", () => {
    expect(parseJSONLoose<{ a: number }>('   \n  {"a":1}  \n')).toEqual({ a: 1 });
  });

  it("strips ```json ... ``` markdown fences", () => {
    const raw = '```json\n{"a": 2}\n```';
    expect(parseJSONLoose<{ a: number }>(raw)).toEqual({ a: 2 });
  });

  it("strips bare ``` ... ``` fences", () => {
    const raw = '```\n{"a": 3}\n```';
    expect(parseJSONLoose<{ a: number }>(raw)).toEqual({ a: 3 });
  });

  it("extracts the first balanced { ... } block from prose", () => {
    const raw = 'Sure! Here is the answer:\n{"effects": [{"title": "x"}]}\nLet me know.';
    expect(parseJSONLoose<{ effects: { title: string }[] }>(raw)).toEqual({
      effects: [{ title: "x" }],
    });
  });

  it("handles nested objects when scanning for balanced braces", () => {
    const raw = 'noise {"intermediate": {"title": "T", "description": "D"}, "x": 1} more';
    const out = parseJSONLoose<{ intermediate: { title: string }; x: number }>(raw);
    expect(out.intermediate.title).toBe("T");
    expect(out.x).toBe(1);
  });

  it("throws when no JSON can be found", () => {
    expect(() => parseJSONLoose("just some prose, no JSON here")).toThrow(
      /Could not parse model output/
    );
  });
});

describe("completeJSON", () => {
  const mockCompletion = (content: string) =>
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
            message: { role: "assistant", content },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  it("does not enable web search by default", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => mockCompletion('{"ok":true}')
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeJSON({ systemPrompt: "s", userPrompt: "u" });

    const [req] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(await (req as Request).clone().text()) as {
      cache_control?: { type: string };
      messages?: Array<{ content: string | Array<{ cache_control?: { type: string } }> }>;
      plugins?: unknown;
      stream?: boolean;
    };
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(Array.isArray(body.messages?.[0]?.content)).toBe(true);
    const systemContent = body.messages?.[0]?.content as Array<{ cache_control?: { type: string } }>;
    expect(systemContent[0]?.cache_control).toEqual({
      type: "ephemeral",
    });
    expect(body.plugins).toBeUndefined();
    expect(body.stream).toBe(false);
  });

  it("enables web search only when requested", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => mockCompletion('{"ok":true}')
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeJSON({ systemPrompt: "s", userPrompt: "u", webSearch: true });

    const [req] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(await (req as Request).clone().text()) as { plugins?: Array<{ id: string }> };
    expect(body.plugins).toEqual([{ id: "web" }]);
  });

  it("streams tokens through the SDK iterator", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const chunks = [
      'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":null,"delta":{"content":"{\\"a\\""}}]}\n\n',
      'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":null,"delta":{"content":":1}"}}]}\n\n',
      'data: {"id":"gen-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"finish_reason":"stop","delta":{}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
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
    vi.stubGlobal("fetch", fetchMock);
    const tokens: string[] = [];

    await expect(
      completeJSON<{ a: number }>({ systemPrompt: "s", userPrompt: "u", onToken: (token) => tokens.push(token) })
    ).resolves.toEqual({ a: 1 });
    expect(tokens).toEqual(['{"a"', ":1}"]);
  });
});
