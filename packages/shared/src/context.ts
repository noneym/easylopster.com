/**
 * Context-window knowledge. Providers that list models with a size (OpenAI-compatible endpoints,
 * OpenRouter, Google) feed `modelsMeta` at key-test time; the rest come from this table, matched
 * by prefix; anything unknown gets a conservative default.
 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Ordered prefix table: first match wins. Keep newest models first. */
const KNOWN: [RegExp, number][] = [
  [/^claude-(fable|opus|sonnet)-5/, 1_000_000],
  [/^claude-haiku-5/, 200_000],
  [/^claude-(opus|sonnet)-4/, 1_000_000],
  [/^claude-3/, 200_000],
  [/^claude/, 200_000],
  [/^gpt-5/, 400_000],
  [/^gpt-4\.1/, 1_000_000],
  [/^gpt-4o/, 128_000],
  [/^gpt-4-turbo/, 128_000],
  [/^gpt-4/, 8_192],
  [/^gpt-3\.5/, 16_385],
  [/^o[1-4]/, 200_000],
  [/^gemini-3/, 1_000_000],
  [/^gemini-2\.5/, 1_048_576],
  [/^gemini-2/, 1_048_576],
  [/^gemini-1\.5-pro/, 2_097_152],
  [/^gemini/, 1_048_576],
  [/^deepseek/, 128_000],
  [/^(qwen|qwq)/, 128_000],
  [/^(llama|meta-llama)/, 128_000],
  [/^mistral|^mixtral|^magistral|^codestral/, 128_000],
  [/^grok/, 131_072],
  [/^glm/, 128_000],
  [/^minimax/, 1_000_000],
  [/^kimi|^moonshot/, 256_000],
];

export type ModelsMeta = Record<string, { context?: number }>;

/** Context window in tokens for a model id: provider metadata first, then the table, then the default. */
export function contextWindowFor(modelId: string, meta?: ModelsMeta | null): { tokens: number; source: "provider" | "table" | "default" } {
  const fromMeta = meta?.[modelId]?.context;
  if (fromMeta && fromMeta > 1000) return { tokens: fromMeta, source: "provider" };
  const bare = modelId.replace(/^[^/]+\//, "").toLowerCase(); // "openai/gpt-4o" -> "gpt-4o"
  for (const [re, tokens] of KNOWN) if (re.test(bare) || re.test(modelId.toLowerCase())) return { tokens, source: "table" };
  return { tokens: DEFAULT_CONTEXT_WINDOW, source: "default" };
}

/** "256k", "1M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * How much of the window the conversation history may use. The system prompt, tool schemas and the
 * answer need room too, so history gets ~55% of the window, between 8k and 160k tokens (cost cap).
 */
export function historyBudgetTokens(contextWindow: number): number {
  return Math.min(160_000, Math.max(8_000, Math.floor(contextWindow * 0.55)));
}

/** Rough tokens for a text (4 chars per token is close enough across providers for budgeting). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Context-length errors differ per provider; this catches the common wordings. */
export function isContextLengthError(message: string): boolean {
  return /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|input is too long|exceeds the (model's )?(maximum )?(context|token)|reduce the length of the messages|request too large/i.test(message);
}
