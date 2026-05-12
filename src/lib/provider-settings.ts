export type ProviderKind = "openai-compatible" | "anthropic-compatible";

export type ProviderSettings = {
  provider: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type SafeProviderSettings = {
  provider: ProviderKind;
  configured: boolean;
  baseUrl: string;
  keyPreview: string;
  model: string;
};

export const defaultProviderSettings: ProviderSettings = {
  provider: "openai-compatible",
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

const defaultBaseUrls: Record<ProviderKind, string> = {
  "openai-compatible": "https://api.openai.com/v1",
  "anthropic-compatible": "https://api.anthropic.com",
};

const defaultModels: Record<ProviderKind, string> = {
  "openai-compatible": "gpt-4o-mini",
  "anthropic-compatible": "claude-3-5-sonnet-latest",
};

export function defaultBaseUrlFor(provider: ProviderKind): string {
  return defaultBaseUrls[provider];
}

export function defaultModelFor(provider: ProviderKind): string {
  return defaultModels[provider];
}

export function sanitizeProviderSettings(
  settings?: Partial<ProviderSettings> | null,
): SafeProviderSettings {
  const normalized = normalizeProviderSettings(settings);

  return {
    provider: normalized.provider,
    configured: normalized.apiKey.length > 0,
    baseUrl: normalized.baseUrl,
    keyPreview: previewKey(normalized.apiKey),
    model: normalized.model,
  };
}

export function normalizeProviderSettings(
  settings?: Partial<ProviderSettings> | null,
): ProviderSettings {
  const provider = isProviderKind(settings?.provider)
    ? settings.provider
    : defaultProviderSettings.provider;
  const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "";
  const baseUrl =
    typeof settings?.baseUrl === "string" && settings.baseUrl.trim()
      ? settings.baseUrl.trim()
      : defaultBaseUrlFor(provider);
  const model =
    typeof settings?.model === "string" && settings.model.trim()
      ? settings.model.trim()
      : defaultModelFor(provider);

  return {
    provider,
    apiKey,
    baseUrl,
    model,
  };
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "openai-compatible" || value === "anthropic-compatible";
}

function previewKey(apiKey: string): string {
  if (!apiKey) {
    return "not set";
  }

  if (apiKey.length <= 8) {
    return "••••";
  }

  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}
