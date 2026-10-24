"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export type AutomationFormState = { error?: string; ok?: boolean } | undefined;

const HEARTBEAT_PROMPT =
  "Proactive check. Review your memory notes, open tasks and anything time-sensitive for the owner. Recurring tasks are automations; create or change their schedules with the automations tool, not here. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply NO_REPLY.";

async function ownBot(botId: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) throw new Error("Bot not found");
  return bot;
}

export async function createAutomation(_prev: AutomationFormState, formData: FormData): Promise<AutomationFormState> {
  const botId = String(formData.get("botId") ?? "");
  await ownBot(botId);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      kind: z.enum(["every", "cron", "at"]),
      everyMin: z.coerce.number().int().min(1).max(10080).optional(),
      cron: z.string().trim().max(100).optional(),
      at: z.string().trim().max(40).optional(),
      prompt: z.string().trim().min(1).max(4000),
      sessionTarget: z.enum(["main", "isolated"]),
      idleOnly: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid form" };
  const d = parsed.data;
  const schedule =
    d.kind === "every" ? { kind: "every", everyMs: (d.everyMin ?? 30) * 60_000 } : d.kind === "cron" ? { kind: "cron", expr: d.cron ?? "" } : { kind: "at", at: new Date(d.at ?? "").toISOString() };
  if (d.kind === "cron" && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(d.cron ?? "")) return { error: "Cron needs 5 fields, e.g. 0 9 * * 1-5" };
  if (d.kind === "at" && isNaN(new Date(d.at ?? "").getTime())) return { error: "Pick a date and time" };
  const count = await db.automation.count({ where: { botId } });
  if (count >= 20) return { error: "Max 20 automations per bot" };
  await db.automation.create({
    data: { botId, name: d.name, schedule, prompt: d.prompt, sessionTarget: d.sessionTarget, idleOnly: d.idleOnly === "on", createdBy: "owner", nextRunAt: null },
  });
  revalidatePath(`/dashboard/bots/${botId}`);
  return { ok: true };
}

export async function addHeartbeat(botId: string) {
  await ownBot(botId);
  const exists = await db.automation.findFirst({ where: { botId, name: "Proactive check" } });
  if (exists) return;
  await db.automation.create({
    data: { botId, name: "Proactive check", schedule: { kind: "every", everyMs: 30 * 60_000 }, prompt: HEARTBEAT_PROMPT, sessionTarget: "main", idleOnly: true, createdBy: "owner" },
  });
  revalidatePath(`/dashboard/bots/${botId}`);
}

export async function toggleAutomation(botId: string, id: string, enabled: boolean) {
  await ownBot(botId);
  await db.automation.updateMany({ where: { id, botId }, data: { enabled, nextRunAt: enabled ? null : undefined, failures: 0 } });
  revalidatePath(`/dashboard/bots/${botId}`);
}

export async function runAutomationNow(botId: string, id: string) {
  await ownBot(botId);
  await db.automation.updateMany({ where: { id, botId }, data: { nextRunAt: new Date(), enabled: true } });
  revalidatePath(`/dashboard/bots/${botId}`);
}

export async function deleteAutomation(botId: string, id: string) {
  await ownBot(botId);
  await db.automation.deleteMany({ where: { id, botId } });
  revalidatePath(`/dashboard/bots/${botId}`);
}
