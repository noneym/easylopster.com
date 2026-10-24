import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { decrypt } from "@easylopster/shared/crypto";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import type { ProviderKey } from "@easylopster/db";

export interface ResolvedModel {
  model: LanguageModel;
  /** "provider/model" shown in the Runtime prompt line and /status. */
  identity: string;
  provider: ProviderId;
  modelId: string;
  /** Provider-specific options for thinking/reasoning levels. */
  providerOptions: Record<string, Record<string, unknown>>;
}

const THINKING_BUDGET: Record<string, number> = { low: 2048, medium: 8192, high: 24576 };

export function resolveModel(key: ProviderKey, modelId: string, thinking = "off"): ResolvedModel {
  const provider = key.provider as ProviderId;
  const apiKey = decrypt(key.encKey);
  const baseURL = key.baseUrl || PROVIDERS[provider]?.defaultBaseUrl || undefined;
  const providerOptions: Record<string, Record<string, unknown>> = {};
  let model: LanguageModel;

  switch (provider) {
    case "anthropic": {
      model = createAnthropic({ apiKey, baseURL })(modelId);
      if (thinking !== "off") providerOptions.anthropic = { thinking: { type: "enabled", budgetTokens: THINKING_BUDGET[thinking] ?? 8192 } };
      break;
    }
    case "openai": {
      model = createOpenAI({ apiKey, baseURL })(modelId);
      if (thinking !== "off") providerOptions.openai = { reasoningEffort: thinking };
      break;
    }
    case "openrouter": {
      model = createOpenRouter({ apiKey })(modelId);
      if (thinking !== "off") providerOptions.openrouter = { reasoning: { effort: thinking } };
      break;
    }
    case "google": {
      model = createGoogleGenerativeAI({ apiKey, baseURL })(modelId);
      if (thinking !== "off") providerOptions.google = { thinkingConfig: { thinkingBudget: THINKING_BUDGET[thinking] ?? 8192 } };
      break;
    }
    case "deepseek":
    case "openai-compatible": {
      if (!baseURL) throw new Error("Base URL missing for OpenAI-compatible provider");
      model = createOpenAICompatible({ name: provider, apiKey, baseURL })(modelId);
      break;
    }
    default:
      throw new Error(`Unknown provider ${provider}`);
  }

  return { model, identity: `${provider}/${modelId}`, provider, modelId, providerOptions };
}
