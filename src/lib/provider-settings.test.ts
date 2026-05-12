import { describe, expect, it } from "vitest";

import {
  defaultBaseUrlFor,
  defaultModelFor,
  sanitizeProviderSettings,
} from "./provider-settings";

describe("provider settings", () => {
  it("defaults to an OpenAI-compatible endpoint", () => {
    expect(sanitizeProviderSettings(null)).toMatchObject({
      provider: "openai-compatible",
      configured: false,
      baseUrl: "https://api.openai.com/v1",
      keyPreview: "not set",
      model: "gpt-4o-mini",
    });
  });

  it("uses the Anthropic-compatible default base URL when selected", () => {
    expect(defaultBaseUrlFor("anthropic-compatible")).toBe("https://api.anthropic.com");
    expect(defaultModelFor("anthropic-compatible")).toBe("claude-3-5-sonnet-latest");
    expect(
      sanitizeProviderSettings({
        provider: "anthropic-compatible",
        apiKey: "sk-ant-test-123456",
        model: "claude-sonnet-4-5-20250929",
      }),
    ).toMatchObject({
      provider: "anthropic-compatible",
      configured: true,
      baseUrl: "https://api.anthropic.com",
      keyPreview: "sk-••••3456",
      model: "claude-sonnet-4-5-20250929",
    });
  });

  it("does not expose the full API key in safe settings", () => {
    const safe = sanitizeProviderSettings({
      provider: "openai-compatible",
      apiKey: "sk-proj-secret-value",
      baseUrl: "https://llm.example.com/v1",
    });

    expect(safe.keyPreview).not.toContain("secret-value");
    expect(safe.baseUrl).toBe("https://llm.example.com/v1");
  });
});
