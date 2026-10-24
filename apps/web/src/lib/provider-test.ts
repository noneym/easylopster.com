import "server-only";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";

export interface KeyTestResult {
  ok: boolean;
  message: string;
  /** Model ids the provider reported, when available (used to prefill the model picker). */
  models?: string[];
}

const TIMEOUT_MS = 12_000;

async function get(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function idsFrom(body: unknown, path: "data" | "models", idKey = "id"): string[] {
  const arr = (body as Record<string, unknown> | null)?.[path];
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m) => (m as Record<string, unknown>)[idKey])
    .filter((x): x is string => typeof x === "string")
    .map((id) => id.replace(/^models\//, ""))
    .sort();
}

/**
 * Validates an API key with a cheap, side-effect-free request (list models). No tokens are spent.
 * Never throws: network and auth failures come back as { ok: false, message }.
 */
export async function testProviderKey(provider: ProviderId, apiKey: string, baseUrl?: string | null): Promise<KeyTestResult> {
  try {
    switch (provider) {
      case "anthropic": {
        const r = await get("https://api.anthropic.com/v1/models?limit=100", {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        });
        if (r.status === 200) return { ok: true, message: "Key accepted by Anthropic.", models: idsFrom(r.body, "data") };
        if (r.status === 401) return { ok: false, message: "Anthropic rejected the key (401)." };
        return { ok: false, message: `Anthropic answered ${r.status}.` };
      }
      case "openai": {
        const r = await get("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
        if (r.status === 200) return { ok: true, message: "Key accepted by OpenAI.", models: idsFrom(r.body, "data").filter((m) => /^(gpt|o\d)/.test(m)) };
        if (r.status === 401) return { ok: false, message: "OpenAI rejected the key (401)." };
        return { ok: false, message: `OpenAI answered ${r.status}.` };
      }
      case "openrouter": {
        const r = await get("https://openrouter.ai/api/v1/auth/key", { Authorization: `Bearer ${apiKey}` });
        if (r.status === 200) {
          const list = await get("https://openrouter.ai/api/v1/models", {}).catch(() => null);
          return { ok: true, message: "Key accepted by OpenRouter.", models: list ? idsFrom(list.body, "data") : undefined };
        }
        if (r.status === 401) return { ok: false, message: "OpenRouter rejected the key (401)." };
        return { ok: false, message: `OpenRouter answered ${r.status}.` };
      }
      case "deepseek": {
        const r = await get(`${(baseUrl || PROVIDERS.deepseek.defaultBaseUrl!).replace(/\/$/, "")}/models`, { Authorization: `Bearer ${apiKey}` });
        if (r.status === 200) return { ok: true, message: "Key accepted by DeepSeek.", models: idsFrom(r.body, "data") };
        if (r.status === 401) return { ok: false, message: "DeepSeek rejected the key (401)." };
        return { ok: false, message: `DeepSeek answered ${r.status}.` };
      }
      case "google": {
        const r = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(apiKey)}`, {});
        if (r.status === 200) return { ok: true, message: "Key accepted by Google.", models: idsFrom(r.body, "models", "name").filter((m) => m.startsWith("gemini")) };
        if (r.status === 400 || r.status === 403) return { ok: false, message: `Google rejected the key (${r.status}).` };
        return { ok: false, message: `Google answered ${r.status}.` };
      }
      case "openai-compatible": {
        if (!baseUrl) return { ok: false, message: "A base URL is required for OpenAI-compatible endpoints." };
        const r = await get(`${baseUrl.replace(/\/$/, "")}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
        if (r.status === 200) return { ok: true, message: "Endpoint answered.", models: idsFrom(r.body, "data") };
        if (r.status === 401) return { ok: false, message: "Endpoint rejected the key (401)." };
        return { ok: false, message: `Endpoint answered ${r.status}.` };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: /abort/i.test(msg) ? "Provider did not answer within 12 seconds." : `Could not reach provider: ${msg}` };
  }
}
