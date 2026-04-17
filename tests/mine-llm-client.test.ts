import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  defaultLLMConfig,
  isAvailable,
  chatCompletion,
  parseLLMJson,
} from "../src/mine/llm/client.js";

describe("defaultLLMConfig", () => {
  const origProvider = process.env.SKILLSET_LLM_PROVIDER;
  const origUrl = process.env.SKILLSET_LLM_URL;
  const origModel = process.env.SKILLSET_LLM_MODEL;

  afterEach(() => {
    if (origProvider) process.env.SKILLSET_LLM_PROVIDER = origProvider;
    else delete process.env.SKILLSET_LLM_PROVIDER;
    if (origUrl) process.env.SKILLSET_LLM_URL = origUrl;
    else delete process.env.SKILLSET_LLM_URL;
    if (origModel) process.env.SKILLSET_LLM_MODEL = origModel;
    else delete process.env.SKILLSET_LLM_MODEL;
  });

  it("uses Anthropic defaults when SKILLSET_LLM_PROVIDER=anthropic", () => {
    process.env.SKILLSET_LLM_PROVIDER = "anthropic";
    delete process.env.SKILLSET_LLM_URL;
    delete process.env.SKILLSET_LLM_MODEL;
    const cfg = defaultLLMConfig();
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.baseUrl).toBe("https://api.anthropic.com");
    expect(cfg.model).toBe("claude-haiku-4-5-20251001");
  });

  it("uses Ollama defaults when SKILLSET_LLM_PROVIDER=ollama", () => {
    process.env.SKILLSET_LLM_PROVIDER = "ollama";
    delete process.env.SKILLSET_LLM_URL;
    delete process.env.SKILLSET_LLM_MODEL;
    const cfg = defaultLLMConfig();
    expect(cfg.provider).toBe("ollama");
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
    expect(cfg.model).toBe("qwen3-coder");
  });

  it("uses claude-cli defaults when SKILLSET_LLM_PROVIDER=claude-cli", () => {
    process.env.SKILLSET_LLM_PROVIDER = "claude-cli";
    delete process.env.SKILLSET_LLM_URL;
    delete process.env.SKILLSET_LLM_MODEL;
    const cfg = defaultLLMConfig();
    expect(cfg.provider).toBe("claude-cli");
    // CLI providers don't use HTTP
    expect(cfg.baseUrl).toBe("");
  });

  it("respects env overrides with matching provider", () => {
    process.env.SKILLSET_LLM_PROVIDER = "ollama";
    process.env.SKILLSET_LLM_URL = "http://custom:9999/v1";
    process.env.SKILLSET_LLM_MODEL = "custom-model";
    const cfg = defaultLLMConfig();
    expect(cfg.baseUrl).toBe("http://custom:9999/v1");
    expect(cfg.model).toBe("custom-model");
  });

  it("honors SKILLSET_LLM_MODEL for Anthropic when it's a claude-* name", () => {
    process.env.SKILLSET_LLM_PROVIDER = "anthropic";
    delete process.env.SKILLSET_LLM_URL;
    process.env.SKILLSET_LLM_MODEL = "claude-sonnet-4-5-20250929";
    const cfg = defaultLLMConfig();
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("ignores Ollama-shaped SKILLSET_LLM_MODEL when provider is Anthropic", () => {
    process.env.SKILLSET_LLM_PROVIDER = "anthropic";
    delete process.env.SKILLSET_LLM_URL;
    process.env.SKILLSET_LLM_MODEL = "qwen3-coder";
    const cfg = defaultLLMConfig();
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("parseLLMJson", () => {
  it("parses plain JSON", () => {
    const r = parseLLMJson<{ x: number }>('{"x": 1}');
    expect(r).toEqual({ x: 1 });
  });

  it("strips code fences", () => {
    const r = parseLLMJson<{ x: number }>('```json\n{"x": 2}\n```');
    expect(r).toEqual({ x: 2 });
  });

  it("extracts JSON from surrounding prose", () => {
    const r = parseLLMJson<{ x: number }>('Here is the result: {"x": 3} Hope this helps!');
    expect(r).toEqual({ x: 3 });
  });

  it("returns null for unparseable", () => {
    expect(parseLLMJson("hello world")).toBeNull();
  });

  it("handles empty input", () => {
    expect(parseLLMJson("")).toBeNull();
  });
});

describe("isAvailable", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("reports reachable + modelPresent when Ollama lists the model", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [{ name: "qwen3-coder:latest" }, { name: "llama3:8b" }],
        }),
        { status: 200 }
      )
    );
    const result = await isAvailable(defaultLLMConfig({ model: "qwen3-coder" }));
    expect(result.reachable).toBe(true);
    expect(result.modelPresent).toBe(true);
  });

  it("reports modelPresent=false when model absent", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ name: "llama3:8b" }] }), { status: 200 })
    );
    const result = await isAvailable(defaultLLMConfig({ model: "qwen3-coder" }));
    expect(result.reachable).toBe(true);
    expect(result.modelPresent).toBe(false);
  });

  it("reports unreachable on fetch failure", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await isAvailable(defaultLLMConfig());
    expect(result.reachable).toBe(false);
  });
});

describe("chatCompletion", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("sends OpenAI-compatible request and parses response", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello back" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
          model: "qwen3-coder",
        }),
        { status: 200 }
      )
    );

    const result = await chatCompletion(defaultLLMConfig(), {
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello back");
    expect(result.tokensIn).toBe(5);
    expect(result.tokensOut).toBe(2);
    expect(mockFetch).toHaveBeenCalled();
    const call = mockFetch.mock.calls[0]!;
    const url = call[0] as string;
    expect(url).toContain("/chat/completions");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("retries on failure", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
          }),
          { status: 200 }
        )
      );

    const result = await chatCompletion(
      defaultLLMConfig({ maxRetries: 2, timeout: 2000 }),
      { messages: [{ role: "user", content: "hi" }] }
    );
    expect(result.content).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
