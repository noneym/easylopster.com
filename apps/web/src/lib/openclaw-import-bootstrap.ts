import { encrypt, maskSecret, randomToken } from "@easylopster/shared/crypto";
import { PROVIDERS, isProviderId, type ProviderId } from "@easylopster/shared/providers";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";
import { testProviderKey } from "@/lib/provider-test";
import { BOT_COMMANDS, isValidBotToken, tg } from "@/lib/telegram";

/**
 * "Import from OpenClaw" into a NEW bot: the uploader script reads openclaw.json (and the usual
 * key env vars / legacy auth profiles) on the OpenClaw machine and sends what it found; this turns
 * it into provider keys and a bot, so the owner ends up with a working copy without filling forms.
 */
export interface OpenClawConfigPayload {
  /** Telegram bot token from channels.telegram.botToken / tokenFile (or an account entry) */
  telegramBotToken?: string;
  /** "provider/model" from agents.defaults.model(.primary) */
  model?: string;
  /** agents.defaults.identity.name / agents.list[].identity.name / IDENTITY.md */
  name?: string;
  /** provider id as OpenClaw names it → API key (from models.providers.*.apiKey, env vars, auth profiles) */
  keys?: Record<string, { apiKey: string; baseUrl?: string; source?: string }>;
  configPath?: string;
  notes?: string[];
}

export interface CreatedSummary {
  botId: string;
  name: string;
  platform: "telegram" | "web";
  tgUsername?: string | null;
  model?: string | null;
  keys: { provider: string; label: string; status: "created" | "existing" | "failed" | "unsupported"; detail?: string }[];
  notes: string[];
}

/** OpenClaw provider ids → ours. Unknown providers with a base URL become openai-compatible keys. */
function mapProvider(openclawId: string): { provider: ProviderId; baseUrl?: string } | null {
  const id = openclawId.toLowerCase();
  if (isProviderId(id)) return { provider: id };
  if (id === "gemini" || id === "google-gemini" || id === "google-ai") return { provider: "google" };
  if (id === "claude") return { provider: "anthropic" };
  const compat: Record<string, string> = {
    groq: "https://api.groq.com/openai/v1",
    mistral: "https://api.mistral.ai/v1",
    xai: "https://api.x.ai/v1",
    together: "https://api.together.xyz/v1",
    fireworks: "https://api.fireworks.ai/inference/v1",
    cerebras: "https://api.cerebras.ai/v1",
    deepinfra: "https://api.deepinfra.com/v1/openai",
    moonshot: "https://api.moonshot.ai/v1",
    kimi: "https://api.moonshot.ai/v1",
    zai: "https://api.z.ai/api/paas/v4",
    glm: "https://api.z.ai/api/paas/v4",
    minimax: "https://api.minimax.io/v1",
    perplexity: "https://api.perplexity.ai",
  };
  if (compat[id]) return { provider: "openai-compatible", baseUrl: compat[id] };
  return null;
}

function webhookUrl(botId: string, secret: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/tg/${botId}/${secret}`;
}
function webhooksEnabled() {
  return /^https:\/\//.test(process.env.APP_URL ?? "") && !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? "");
}

export async function createBotFromOpenClaw(user: { id: string; limitBots?: number | null; limitNodes?: number | null; limitMcp?: number | null; limitMessagesPerDay?: number | null; role?: string }, cfg: OpenClawConfigPayload, fallbackName: string): Promise<CreatedSummary> {
  const notes: string[] = [...(cfg.notes ?? [])];
  const limits = limitsFor(user as never);
  const count = await db.bot.count({ where: { userId: user.id } });
  if (count >= limits.bots) throw new Error(`Your account allows ${limits.bots} bots; delete one before importing.`);

  // 1) Provider keys
  const keys: CreatedSummary["keys"] = [];
  const keyByProvider = new Map<ProviderId, string>();
  for (const [ocId, k] of Object.entries(cfg.keys ?? {})) {
    const apiKey = String(k?.apiKey ?? "").trim();
    if (!apiKey) continue;
    const m = mapProvider(ocId);
    if (!m) {
      keys.push({ provider: ocId, label: ocId, status: "unsupported", detail: "no matching provider here; add it as an OpenAI-compatible key if it has one" });
      continue;
    }
    const baseUrl = k.baseUrl || m.baseUrl || PROVIDERS[m.provider].defaultBaseUrl || null;
    const last4 = maskSecret(apiKey).slice(-4);
    const existing = await db.providerKey.findFirst({ where: { userId: user.id, provider: m.provider, keyLast4: last4 } });
    if (existing) {
      keys.push({ provider: m.provider, label: existing.label, status: "existing" });
      keyByProvider.set(m.provider, existing.id);
      continue;
    }
    const test = await testProviderKey(m.provider, apiKey, baseUrl);
    if (!test.ok) {
      keys.push({ provider: m.provider, label: PROVIDERS[m.provider].label, status: "failed", detail: test.message.slice(0, 200) });
      continue;
    }
    const label = `${PROVIDERS[m.provider].label} (OpenClaw${ocId !== m.provider ? `: ${ocId}` : ""})`;
    const row = await db.providerKey.create({
      data: {
        userId: user.id,
        provider: m.provider,
        label,
        encKey: encrypt(apiKey),
        keyLast4: last4,
        baseUrl,
        defaultModel: PROVIDERS[m.provider].defaultModel || test.models?.[0] || "",
        lastTestedAt: new Date(),
        lastTestOk: true,
        lastTestMsg: test.message.slice(0, 500),
        modelsCache: test.models?.length ? test.models.slice(0, 500) : undefined,
        modelsMeta: test.modelsMeta && Object.keys(test.modelsMeta).length ? test.modelsMeta : undefined,
      },
    });
    keys.push({ provider: m.provider, label, status: "created" });
    keyByProvider.set(m.provider, row.id);
  }

  // 2) Model: "provider/model" from the config, matched to a key of that provider.
  let providerKeyId: string | null = null;
  let model: string | null = null;
  const sel = String(cfg.model ?? "").trim();
  if (sel.includes("/")) {
    const [p, ...rest] = sel.split("/");
    const m = mapProvider(p!);
    const id = rest.join("/");
    if (m && keyByProvider.has(m.provider)) {
      providerKeyId = keyByProvider.get(m.provider)!;
      model = id;
    } else if (m) {
      const any = await db.providerKey.findFirst({ where: { userId: user.id, provider: m.provider }, orderBy: { createdAt: "asc" } });
      if (any) {
        providerKeyId = any.id;
        model = id;
      } else notes.push(`OpenClaw used ${sel}, but no ${PROVIDERS[m.provider].label} key was found; pick a model in bot settings.`);
    } else notes.push(`OpenClaw used ${sel}; that provider is not available here, pick a model in bot settings.`);
  }
  if (!providerKeyId) {
    const first = keyByProvider.values().next().value as string | undefined;
    const any = first ? await db.providerKey.findUnique({ where: { id: first } }) : await db.providerKey.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (!any) throw new Error("No API key was found in the OpenClaw config and your account has none yet; add an API key first, then run the import again.");
    providerKeyId = any.id;
    model = model ?? any.defaultModel;
  }

  // 3) Bot: Telegram when the token works, otherwise web chat only.
  const name = (cfg.name ?? "").trim().slice(0, 60) || fallbackName;
  const token = String(cfg.telegramBotToken ?? "").trim();
  let platform: "telegram" | "web" = "web";
  let tgBotId: string | null = null;
  let tgUsername: string | null = null;
  if (token) {
    if (!isValidBotToken(token)) notes.push("The Telegram token in openclaw.json does not look like a BotFather token; the bot was created for web chat only. Add the token in bot settings.");
    else {
      const me = await tg.getMe(token);
      if (!me.ok) notes.push(`Telegram rejected the token from openclaw.json (${me.description}); the bot was created for web chat only.`);
      else {
        const dup = await db.bot.findFirst({ where: { platform: "telegram", tgBotId: String(me.result.id) } });
        if (dup) notes.push(`@${me.result.username ?? me.result.id} is already connected to a bot here; this import created a web-only bot instead.`);
        else {
          platform = "telegram";
          tgBotId = String(me.result.id);
          tgUsername = me.result.username ?? null;
        }
      }
    }
  } else notes.push("No Telegram token in openclaw.json: the bot answers in the web chat; add a token in bot settings to put it on Telegram.");

  const secret = randomToken(24);
  const bot = await db.bot.create({
    data: {
      userId: user.id,
      name,
      platform,
      encToken: platform === "telegram" ? encrypt(token) : null,
      tgBotId,
      tgUsername,
      webhookSecret: secret,
      providerKeyId,
      model,
      agentName: name,
    },
  });
  if (platform === "telegram") {
    const hook = webhooksEnabled() ? await tg.setWebhook(token, webhookUrl(bot.id, secret), secret) : ({ ok: true } as const);
    await tg.setMyCommands(token, BOT_COMMANDS).catch(() => {});
    await db.bot.update({
      where: { id: bot.id },
      data: hook.ok ? { webhookSetAt: webhooksEnabled() ? new Date() : null } : { lastError: `setWebhook failed: ${hook.description}`.slice(0, 1000), lastErrorAt: new Date(), status: "error" },
    });
    if (!hook.ok) notes.push(`Telegram webhook could not be set: ${hook.description}. Stop the OpenClaw instance (it may still hold the token) and press "Reset webhook" on the bot page.`);
    else notes.push("Stop the OpenClaw instance if it is still running: two programs cannot receive the same bot's messages.");
  }
  return { botId: bot.id, name, platform, tgUsername, model, keys, notes };
}
