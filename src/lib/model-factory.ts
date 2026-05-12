import { ChatAnthropic } from "@langchain/anthropic";

import type { ProviderSettings } from "./provider-settings";

type ChatMessage = {
  role: string;
  content: unknown;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export function createChatModel(settings: ProviderSettings) {
  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    return null;
  }

  if (settings.provider === "anthropic-compatible") {
    return new ChatAnthropic({
      apiKey,
      anthropicApiUrl: settings.baseUrl,
      model: settings.model,
      temperature: 0,
      maxRetries: 1,
    });
  }

  return new OpenAICompatibleChatModel({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
  });
}

class OpenAICompatibleChatModel {
  constructor(
    private readonly settings: {
      apiKey: string;
      baseUrl: string;
      model: string;
    },
  ) {}

  async invoke(messages: ChatMessage[]) {
    const url = `${this.settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.settings.apiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          temperature: 0,
          stream: false,
          max_tokens: 2200,
          messages: messages.map((message) => ({
            role: message.role,
            content: normalizeMessageContent(message.content),
          })),
        }),
      });
    } catch (error) {
      throw new Error(
        `OpenAI-compatible request to ${url} failed: ${formatNetworkError(error)}`,
      );
    }

    const text = await response.text();
    const payload = parseChatCompletion(text);
    if (!response.ok) {
      throw new Error(
        payload?.error?.message || `OpenAI-compatible request failed with ${response.status}.`,
      );
    }

    return {
      content: payload?.choices?.[0]?.message?.content ?? "",
    };
  }
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          return String(item.text);
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return content ? JSON.stringify(content) : "";
}

function parseChatCompletion(text: string): ChatCompletionResponse | null {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return null;
  }
}

function formatNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown network error";
  }

  const cause = error.cause as
    | {
        code?: string;
        syscall?: string;
        address?: string;
        port?: number;
      }
    | undefined;
  const details = [
    cause?.code,
    cause?.syscall,
    cause?.address && cause?.port ? `${cause.address}:${cause.port}` : undefined,
  ].filter(Boolean);

  return details.length > 0
    ? `${error.message} (${details.join(" ")})`
    : error.message;
}
