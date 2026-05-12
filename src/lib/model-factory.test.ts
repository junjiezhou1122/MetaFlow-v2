import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatModel, createDirectChatModel } from "./model-factory";

describe("model factory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not create a live model without an API key", () => {
    expect(
      createChatModel({
        provider: "openai-compatible",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      }),
    ).toBeNull();
  });

  it("creates OpenAI-compatible models", () => {
    expect(
      createChatModel({
        provider: "openai-compatible",
        apiKey: "sk-test",
        baseUrl: "https://llm.example.com/v1",
        model: "gpt-4o-mini",
      }),
    ).toBeTruthy();
  });

  it("invokes OpenAI-compatible models through direct chat completions fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "```html filename=\"index.html\"\nOK\n```" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const model = createDirectChatModel({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "https://llm.example.com/v1",
      model: "gpt-5.4",
    });

    const result = await model?.invoke([{ role: "user", content: "Build app" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://llm.example.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
    expect(result?.content).toContain("index.html");
  });

  it("wraps OpenAI-compatible fetch failures with provider context", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const model = createDirectChatModel({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "https://llm.example.com/v1",
      model: "gpt-5.4",
    });

    await expect(model?.invoke([{ role: "user", content: "Build app" }])).rejects.toThrow(
      "OpenAI-compatible request to https://llm.example.com/v1/chat/completions failed: fetch failed",
    );
  });

  it("includes network cause details when OpenAI-compatible fetch is blocked", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed", {
        cause: {
          code: "EPERM",
          syscall: "connect",
          address: "181.215.5.243",
          port: 3009,
        },
      }),
    );
    const model = createDirectChatModel({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "http://181.215.5.243:3009/v1",
      model: "gpt-5.4",
    });

    await expect(model?.invoke([{ role: "user", content: "Build app" }])).rejects.toThrow(
      "fetch failed (EPERM connect 181.215.5.243:3009)",
    );
  });

  it("creates Anthropic-compatible models", () => {
    expect(
      createChatModel({
        provider: "anthropic-compatible",
        apiKey: "sk-ant-test",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-5-sonnet-latest",
      }),
    ).toBeTruthy();
  });
});
