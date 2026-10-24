"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decrypt, encrypt, randomToken } from "@easylopster/shared/crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";
import { BOT_COMMANDS, isValidBotToken, tg } from "@/lib/telegram";

export type BotFormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string } | undefined;

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] = i.message;
  return out;
}

function webhookUrl(botId: string, secret: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/tg/${botId}/${secret}`;
}

/** Telegram only accepts public HTTPS webhooks; in local dev the gateway polls instead (TELEGRAM_POLLING=1). */
function webhooksEnabled() {
  return /^https:\/\//.test(process.env.APP_URL ?? "") && !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? "");
}

export async function createBot(_prev: BotFormState, formData: FormData): Promise<BotFormState> {
  const user = await requireUser();
  const count = await db.bot.count({ where: { userId: user.id } });
  if (count >= LIMITS.bots) return { error: `The beta allows ${LIMITS.bots} bots per account.` };

  const parsed = z
    .object({
      name: z.string().trim().min(1, "Give the bot a name").max(60),
      token: z.string().trim().refine(isValidBotToken, "That does not look like a BotFather token (123456789:ABC…)"),
      providerKeyId: z.string().trim().min(1, "Pick an API key"),
      model: z.string().trim().max(200).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const { name, token, providerKeyId } = parsed.data;

  const key = await db.providerKey.findFirst({ where: { id: providerKeyId, userId: user.id } });
  if (!key) return { fieldErrors: { providerKeyId: "Key not found" } };

  const me = await tg.getMe(token);
  if (!me.ok) return { fieldErrors: { token: `Telegram rejected the token: ${me.description}` } };

  const existing = await db.bot.findFirst({ where: { platform: "telegram", tgBotId: String(me.result.id) } });
  if (existing) return { fieldErrors: { token: "This bot is already connected to an account" } };

  const secret = randomToken(24);
  const bot = await db.bot.create({
    data: {
      userId: user.id,
      name,
      encToken: encrypt(token),
      tgBotId: String(me.result.id),
      tgUsername: me.result.username ?? null,
      webhookSecret: secret,
      providerKeyId: key.id,
      model: parsed.data.model || key.defaultModel,
      agentName: name,
    },
  });

  const hook = webhooksEnabled() ? await tg.setWebhook(token, webhookUrl(bot.id, secret), secret) : ({ ok: true } as const);
  await tg.setMyCommands(token, BOT_COMMANDS);
  await db.bot.update({
    where: { id: bot.id },
    data: hook.ok
      ? { webhookSetAt: webhooksEnabled() ? new Date() : null, lastError: null, lastErrorAt: null }
      : { lastError: `setWebhook failed: ${hook.description}`.slice(0, 1000), lastErrorAt: new Date(), status: "error" },
  });

  revalidatePath("/dashboard/bots");
  redirect(`/dashboard/bots/${bot.id}`);
}

const settingsSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  agentName: z.string().trim().max(60).optional().or(z.literal("")),
  providerKeyId: z.string().trim().min(1, "Pick an API key"),
  model: z.string().trim().min(1, "Model id is required").max(200),
  thinking: z.enum(["off", "low", "medium", "high"]),
  systemPrompt: z.string().max(20_000).optional().or(z.literal("")),
  userProfile: z.string().max(4_000).optional().or(z.literal("")),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]),
  groupPolicy: z.enum(["allowlist", "open", "disabled"]),
  requireMention: z.string().optional(),
  streaming: z.enum(["off", "partial", "block", "progress"]),
  replyToMode: z.enum(["off", "first", "all"]),
  exec: z.enum(["off", "sandbox"]).default("off"),
  sessionReset: z.enum(["none", "daily", "idle"]).default("none"),
  resetAtHour: z.coerce.number().int().min(0).max(23).default(4),
  resetIdleMinutes: z.coerce.number().int().min(5).max(10080).default(240),
  ackReaction: z.string().trim().max(8).optional().or(z.literal("")),
  dreaming: z.string().optional(),
});

export async function updateBot(_prev: BotFormState, formData: FormData): Promise<BotFormState> {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const d = parsed.data;
  const key = await db.providerKey.findFirst({ where: { id: d.providerKeyId, userId: user.id }, select: { id: true } });
  if (!key) return { fieldErrors: { providerKeyId: "Key not found" } };

  const r = await db.bot.updateMany({
    where: { id: d.id, userId: user.id },
    data: {
      name: d.name,
      agentName: d.agentName || d.name,
      providerKeyId: key.id,
      model: d.model,
      thinking: d.thinking,
      systemPrompt: d.systemPrompt || null,
      userProfile: d.userProfile || null,
      dmPolicy: d.dmPolicy,
      groupPolicy: d.groupPolicy,
      requireMention: d.requireMention === "on",
      streaming: d.streaming,
      replyToMode: d.replyToMode,
      toolPolicy: { exec: d.exec },
      sessionReset: d.sessionReset,
      resetAtHour: d.resetAtHour,
      resetIdleMinutes: d.resetIdleMinutes,
      ackReaction: d.ackReaction || "",
      dreaming: d.dreaming === "on",
    },
  });
  if (r.count === 0) return { error: "Bot not found" };
  revalidatePath(`/dashboard/bots/${d.id}`);
  revalidatePath("/dashboard/bots");
  return { ok: true, message: "Saved." };
}

export async function decidePairing(id: string, decision: "approved" | "rejected") {
  const user = await requireUser();
  const req = await db.pairingRequest.findFirst({ where: { id, bot: { userId: user.id } }, include: { bot: true } });
  if (!req || req.status !== "pending") return;
  await db.$transaction(async (tx) => {
    await tx.pairingRequest.update({ where: { id }, data: { status: decision, decidedAt: new Date() } });
    if (decision === "approved") {
      await tx.botAllowlist.upsert({
        where: { botId_kind_tgId: { botId: req.botId, kind: "user", tgId: req.tgUserId } },
        create: { botId: req.botId, kind: "user", tgId: req.tgUserId, label: req.tgUsername ? `@${req.tgUsername}` : req.tgName },
        update: {},
      });
    }
  });
  if (decision === "approved") {
    // Mirrors OpenClaw's --notify text.
    await tg.sendMessage(decrypt(req.bot.encToken), req.tgChatId, "✅ Access approved. Send a message to start chatting.");
  }
  revalidatePath(`/dashboard/bots/${req.botId}`);
  revalidatePath("/dashboard");
}

export async function addAllowlistEntry(_prev: BotFormState, formData: FormData): Promise<BotFormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      botId: z.string(),
      kind: z.enum(["user", "group"]),
      tgId: z.string().trim().regex(/^-?\d{3,20}$/, "Telegram ids are numeric (groups start with -100)"),
      label: z.string().trim().max(80).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const { botId, kind, tgId, label } = parsed.data;
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) return { error: "Bot not found" };
  await db.botAllowlist.upsert({
    where: { botId_kind_tgId: { botId, kind, tgId } },
    create: { botId, kind, tgId, label: label || null },
    update: { label: label || null },
  });
  revalidatePath(`/dashboard/bots/${botId}`);
  return { ok: true };
}

export async function removeAllowlistEntry(id: string) {
  const user = await requireUser();
  const row = await db.botAllowlist.findFirst({ where: { id, bot: { userId: user.id } } });
  if (!row) return;
  await db.botAllowlist.delete({ where: { id } });
  revalidatePath(`/dashboard/bots/${row.botId}`);
}

export async function setBotStatus(id: string, status: "active" | "paused") {
  const user = await requireUser();
  await db.bot.updateMany({ where: { id, userId: user.id }, data: { status, lastError: status === "active" ? null : undefined } });
  revalidatePath(`/dashboard/bots/${id}`);
  revalidatePath("/dashboard/bots");
}

export async function resetWebhook(id: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id, userId: user.id } });
  if (!bot) return;
  const token = decrypt(bot.encToken);
  const hook = webhooksEnabled() ? await tg.setWebhook(token, webhookUrl(bot.id, bot.webhookSecret), bot.webhookSecret) : ({ ok: true } as const);
  await tg.setMyCommands(token, BOT_COMMANDS);
  await db.bot.update({
    where: { id },
    data: hook.ok
      ? { webhookSetAt: new Date(), lastError: null, lastErrorAt: null, status: bot.status === "error" ? "active" : bot.status }
      : { lastError: `setWebhook failed: ${hook.description}`.slice(0, 1000), lastErrorAt: new Date() },
  });
  revalidatePath(`/dashboard/bots/${id}`);
}

export async function deleteBot(id: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id, userId: user.id } });
  if (!bot) return;
  await tg.deleteWebhook(decrypt(bot.encToken)).catch(() => {});
  await db.bot.delete({ where: { id } });
  revalidatePath("/dashboard/bots");
  redirect("/dashboard/bots");
}
