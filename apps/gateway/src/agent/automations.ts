import { Queue } from "bullmq";
import { botScope } from "../account-scope.ts";
import { CronExpressionParser } from "cron-parser";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db, type Automation } from "@easylopster/db";
import { QUEUES, queuePrefix } from "@easylopster/shared";
import { createRedis } from "../redis.ts";
import type { InboundJob } from "./inbound.ts";

/**
 * Automations (OpenClaw "automations"/cron): reminders, delayed self-wakeups, recurring checks.
 * Heartbeat is just a recurring automation ("Proactive check") whose silent reply is NO_REPLY.
 */

export type Schedule = { kind: "at"; at: string } | { kind: "every"; everyMs: number } | { kind: "cron"; expr: string; tz?: string };

export const HEARTBEAT_PROMPT =
  "Proactive check. Review your memory notes, open tasks and anything time-sensitive for the owner. Recurring tasks are automations; create or change their schedules with the automations tool, not here. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply NO_REPLY.";
export const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_ACK_MAX_CHARS = 300;
const IDLE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const TICK_MS = 20_000;
const MIN_EVERY_MS = 60_000;

const log = (m: string) => console.log(`[automations] ${new Date().toISOString()} ${m}`);

export function scheduleSummary(s: Schedule): string {
  if (s.kind === "at") return `once at ${s.at}`;
  if (s.kind === "every") return `every ${Math.round(s.everyMs / 60_000)} min`;
  return `cron ${s.expr}${s.tz ? ` (${s.tz})` : ""}`;
}

export function nextRun(s: Schedule, from = new Date(), tz = "UTC"): Date | null {
  if (s.kind === "at") {
    const d = new Date(s.at);
    return isNaN(d.getTime()) || d <= from ? null : d;
  }
  if (s.kind === "every") return new Date(from.getTime() + Math.max(s.everyMs, MIN_EVERY_MS));
  try {
    return CronExpressionParser.parse(s.expr, { currentDate: from, tz: s.tz ?? tz }).next().toDate();
  } catch {
    return null;
  }
}

export function parseSchedule(raw: unknown): Schedule | null {
  const r = raw as Partial<Schedule> & { kind?: string };
  if (!r || typeof r !== "object") return null;
  if (r.kind === "at" && typeof (r as { at?: unknown }).at === "string") return { kind: "at", at: (r as { at: string }).at };
  if (r.kind === "every" && typeof (r as { everyMs?: unknown }).everyMs === "number") return { kind: "every", everyMs: (r as { everyMs: number }).everyMs };
  if (r.kind === "cron" && typeof (r as { expr?: unknown }).expr === "string") return { kind: "cron", expr: (r as { expr: string }).expr, tz: (r as { tz?: string }).tz };
  return null;
}

/** Polls due automations and enqueues one inbound job per run. */
export function startAutomationScheduler(): () => void {
  const queue = new Queue<InboundJob>(QUEUES.inbound, { connection: createRedis(), prefix: queuePrefix() });
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const due = await db.automation.findMany({
        where: { enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }], bot: { status: "active", ...botScope() } },
        include: { bot: { select: { user: { select: { timezone: true } } } } },
        take: 50,
      });
      for (const a of due) {
        const schedule = parseSchedule(a.schedule);
        if (!schedule) {
          await db.automation.update({ where: { id: a.id }, data: { enabled: false, lastStatus: "error", lastError: "invalid schedule" } });
          continue;
        }
        const tz = a.bot.user.timezone || "UTC";
        if (a.nextRunAt == null) {
          // First scheduling after creation/restart: do not fire immediately for recurring jobs.
          const next = nextRun(schedule, now, tz);
          await db.automation.update({ where: { id: a.id }, data: next ? { nextRunAt: next } : { enabled: false, lastStatus: "error", lastError: "schedule is in the past" } });
          continue;
        }
        const slot = a.nextRunAt.toISOString();
        const next = schedule.kind === "at" ? null : nextRun(schedule, now, tz);
        // BullMQ custom ids may not contain ":"; enqueue first so a failure leaves the slot intact.
        await queue.add(
          "automation",
          { botId: a.botId, source: "automation", sessionKey: a.sessionTarget === "isolated" ? `auto:${a.botId}:${a.id}` : `dm:${a.botId}:main`, payload: { automationId: a.id, slot }, receivedAt: now.toISOString() },
          { jobId: `auto-${a.id}-${a.nextRunAt.getTime()}`, removeOnComplete: 500, removeOnFail: 500 },
        );
        await db.automation.update({ where: { id: a.id }, data: next ? { nextRunAt: next } : { nextRunAt: null, enabled: false } });
        log(`enqueued ${a.name} (${a.id}) slot=${slot}`);
      }
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), TICK_MS);
  return () => {
    clearInterval(t);
    void queue.close();
  };
}

/** Whether the owner talked to the bot recently (idleOnly guard). */
export async function ownerActiveRecently(botId: string): Promise<boolean> {
  const conv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId, sessionKey: `dm:${botId}:main` } }, select: { id: true } });
  if (!conv) return false;
  const last = await db.message.findFirst({ where: { conversationId: conv.id, role: "user", senderName: { not: "automation" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return !!last && Date.now() - last.createdAt.getTime() < IDLE_WINDOW_MS;
}

/** Heartbeat semantics: HEARTBEAT_OK is stripped; a short ack is silent. */
export function automationReplyIsSilent(text: string): { silent: boolean; text: string } {
  const stripped = text.replace(/\bHEARTBEAT_OK\b/g, "").trim();
  if (!stripped || stripped.toUpperCase() === "NO_REPLY") return { silent: true, text: "" };
  if (text.includes(HEARTBEAT_TOKEN) && stripped.length <= HEARTBEAT_ACK_MAX_CHARS) return { silent: true, text: stripped };
  return { silent: false, text: stripped };
}

export async function recordRun(a: Automation, status: "ok" | "silent" | "skipped" | "error", result?: string, error?: string) {
  const failures = status === "error" ? a.failures + 1 : 0;
  await db.automation.update({
    where: { id: a.id },
    data: {
      lastRunAt: new Date(),
      lastStatus: status,
      lastResult: result?.slice(0, 4000) ?? null,
      lastError: error?.slice(0, 1000) ?? null,
      runCount: { increment: status === "skipped" ? 0 : 1 },
      failures,
      ...(failures >= MAX_FAILURES ? { enabled: false } : {}),
    },
  });
  if (failures >= MAX_FAILURES) log(`disabled ${a.name} after ${failures} failures`);
}

// ───────────────────────── agent tool ─────────────────────────

const scheduleSchema = z.union([
  z.object({ kind: z.literal("at"), at: z.string().describe("ISO-8601 datetime, one-shot (auto-deletes after it fires)") }),
  z.object({ kind: z.literal("every"), everyMs: z.number().int().min(MIN_EVERY_MS).describe("interval in milliseconds, min 60000") }),
  z.object({ kind: z.literal("cron"), expr: z.string().describe("5-field cron expression"), tz: z.string().optional().describe("IANA timezone, defaults to the owner's") }),
]);

export function automationsTools(botId: string, timezone: string): ToolSet {
  return {
    automations: tool({
      description:
        "Schedule reminders, delayed self-wakeups and recurring work. Never exec sleep/poll as a timer. ACTIONS: list | add (name + schedule + message) | update id (partial) | remove id | run id (fires now). SCHEDULE: {kind:\"at\",at:ISO} one-shot; {kind:\"every\",everyMs}; {kind:\"cron\",expr,tz?}. When it fires you receive `message` as a new turn in the owner's main session and your reply is sent to the owner, so write the message as the reminder you want to receive (include useful context from now). sessionTarget \"isolated\" runs with no history. idleOnly skips runs while the owner is actively chatting.",
      inputSchema: z.object({
        action: z.enum(["list", "add", "update", "remove", "run"]),
        id: z.string().optional(),
        name: z.string().max(80).optional(),
        schedule: scheduleSchema.optional(),
        message: z.string().max(4000).optional(),
        sessionTarget: z.enum(["main", "isolated"]).optional(),
        idleOnly: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async (p) => {
        if (p.action === "list") {
          const rows = await db.automation.findMany({ where: { botId }, orderBy: { createdAt: "asc" } });
          return {
            automations: rows.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, schedule: scheduleSummary(parseSchedule(a.schedule)!), nextRunAt: a.nextRunAt, lastRunAt: a.lastRunAt, lastStatus: a.lastStatus, message: a.prompt.slice(0, 200) })),
            now: new Date().toISOString(),
            timezone,
          };
        }
        if (p.action === "add") {
          if (!p.name || !p.schedule || !p.message) return { error: "add needs name, schedule and message" };
          const next = nextRun(p.schedule, new Date(), timezone);
          if (!next) return { error: "schedule is invalid or in the past" };
          const count = await db.automation.count({ where: { botId } });
          if (count >= 20) return { error: "This bot already has 20 automations; remove one first." };
          const a = await db.automation.create({
            data: { botId, name: p.name, schedule: p.schedule as never, prompt: p.message, sessionTarget: p.sessionTarget ?? "main", idleOnly: p.idleOnly ?? false, createdBy: "agent", nextRunAt: next },
          });
          return { ok: true, id: a.id, nextRunAt: next.toISOString(), schedule: scheduleSummary(p.schedule) };
        }
        if (!p.id) return { error: "id is required" };
        const a = await db.automation.findFirst({ where: { id: p.id, botId } });
        if (!a) return { error: "automation not found" };
        if (p.action === "remove") {
          await db.automation.delete({ where: { id: a.id } });
          return { ok: true };
        }
        if (p.action === "update") {
          const schedule = p.schedule ?? parseSchedule(a.schedule)!;
          const next = p.schedule ? nextRun(p.schedule, new Date(), timezone) : a.nextRunAt;
          if (p.schedule && !next) return { error: "schedule is invalid or in the past" };
          await db.automation.update({
            where: { id: a.id },
            data: { name: p.name ?? a.name, schedule: schedule as never, prompt: p.message ?? a.prompt, sessionTarget: p.sessionTarget ?? a.sessionTarget, idleOnly: p.idleOnly ?? a.idleOnly, enabled: p.enabled ?? a.enabled, nextRunAt: next },
          });
          return { ok: true, nextRunAt: next?.toISOString() ?? null };
        }
        if (p.action === "run") {
          await db.automation.update({ where: { id: a.id }, data: { nextRunAt: new Date(), enabled: true } });
          return { ok: true, note: "Queued; it fires within ~20 seconds as a separate turn." };
        }
        return { error: "unknown action" };
      },
    }),
  };
}
