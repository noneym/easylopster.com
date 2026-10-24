/**
 * LLM provider registry. The UI, the key-test endpoint and the gateway's model factory all read from here,
 * so adding a provider is a one-place change.
 */
export type ProviderId = "anthropic" | "openai" | "openrouter" | "deepseek" | "google" | "openai-compatible";

export interface ModelInfo {
  id: string;
  label: string;
  /** Rough context window in tokens, for the UI. */
  context?: number;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Short hint under the key field. */
  keyHint: string;
  keyPrefix?: string;
  docsUrl: string;
  /** Needs a base URL from the user (OpenAI-compatible endpoints). */
  needsBaseUrl?: boolean;
  defaultBaseUrl?: string;
  models: ModelInfo[];
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyHint: "console.anthropic.com → API Keys",
    keyPrefix: "sk-ant-",
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", context: 1_000_000 },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", context: 1_000_000 },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", context: 1_000_000 },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", context: 200_000 },
    ],
    defaultModel: "claude-sonnet-5-5",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyHint: "platform.openai.com → API keys",
    keyPrefix: "sk-",
    docsUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.5-mini", label: "GPT-5.5 mini" },
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
    defaultModel: "gpt-5.5-mini",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyHint: "openrouter.ai → Keys. Any model id from openrouter.ai/models works.",
    keyPrefix: "sk-or-",
    docsUrl: "https://openrouter.ai/keys",
    models: [
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5 (via OpenRouter)" },
      { id: "openai/gpt-5.5-mini", label: "GPT-5.5 mini (via OpenRouter)" },
      { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
    defaultModel: "anthropic/claude-sonnet-5.5",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyHint: "platform.deepseek.com → API keys",
    keyPrefix: "sk-",
    docsUrl: "https://platform.deepseek.com/api_keys",
    needsBaseUrl: false,
    defaultBaseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
    ],
    defaultModel: "deepseek-chat",
  },
  google: {
    id: "google",
    label: "Google Gemini",
    keyHint: "aistudio.google.com → Get API key",
    docsUrl: "https://aistudio.google.com/app/apikey",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
    defaultModel: "gemini-2.5-flash",
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI-compatible (custom URL)",
    keyHint: "Any endpoint that speaks the OpenAI chat API: Ollama, vLLM, Groq, Together, local proxies.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    needsBaseUrl: true,
    models: [],
    defaultModel: "",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(x: string): x is ProviderId {
  return x in PROVIDERS;
}
