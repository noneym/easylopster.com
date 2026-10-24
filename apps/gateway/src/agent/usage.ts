import { db } from "@easylopster/db";
import { env } from "../env.ts";

function utcDay(d = new Date()) {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/** Returns false when the account hit its daily message quota. */
export async function checkQuota(userId: string): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = env().BETA_MAX_MESSAGES_PER_DAY;
  const rows = await db.usageDaily.findMany({ where: { userId, day: utcDay() }, select: { messages: true } });
  const used = rows.reduce((a, r) => a + r.messages, 0);
  return { ok: used < limit, used, limit };
}

export async function recordUsage(userId: string, botId: string, delta: { messages?: number; tokensIn?: number; tokensOut?: number; toolCalls?: number }) {
  const day = utcDay();
  await db.usageDaily.upsert({
    where: { userId_botId_day: { userId, botId, day } },
    create: { userId, botId, day, messages: delta.messages ?? 0, tokensIn: delta.tokensIn ?? 0, tokensOut: delta.tokensOut ?? 0, toolCalls: delta.toolCalls ?? 0 },
    update: {
      messages: { increment: delta.messages ?? 0 },
      tokensIn: { increment: delta.tokensIn ?? 0 },
      tokensOut: { increment: delta.tokensOut ?? 0 },
      toolCalls: { increment: delta.toolCalls ?? 0 },
    },
  });
}
