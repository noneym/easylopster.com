import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@easylopster/db";

/**
 * Standing intents (OpenClaw `intent` tool): event-conditioned reminders. The agent arms one with
 * trigger keywords; when a later message matches, the runtime injects the reminder automatically.
 */

export function intentTools(botId: string, conversationId: string): ToolSet {
  return {
    intent: tool({
      description:
        "Create, list, or explicitly cancel event-conditioned standing intents. A created intent is armed; the system injects the reminder automatically when a later message matches its trigger keywords. Do not deliver it early or cancel it unless the user asks. Use the automations tool for time-based reminders.",
      inputSchema: z.object({
        action: z.enum(["create", "list", "cancel"]),
        id: z.string().optional(),
        description: z.string().max(1000).optional().describe("What to remind / do when it fires"),
        triggerKeywords: z.array(z.string().min(2).max(60)).max(12).optional(),
        scope: z.enum(["conversation", "anywhere"]).default("conversation"),
        expiresAt: z.string().optional().describe("ISO-8601"),
        maxFires: z.number().int().min(1).max(100).default(1),
      }),
      execute: async (p) => {
        if (p.action === "list") {
          const rows = await db.intent.findMany({ where: { botId, active: true }, orderBy: { createdAt: "asc" } });
          return { intents: rows.map((r) => ({ id: r.id, description: r.description, triggerKeywords: r.triggerKeywords, scope: r.scope, fires: r.fires, maxFires: r.maxFires, expiresAt: r.expiresAt })) };
        }
        if (p.action === "create") {
          if (!p.description || !p.triggerKeywords?.length) return { error: "description and triggerKeywords are required" };
          const count = await db.intent.count({ where: { botId, active: true } });
          if (count >= 30) return { error: "Too many active intents (30); cancel some first." };
          const r = await db.intent.create({
            data: {
              botId,
              description: p.description,
              triggerKeywords: p.triggerKeywords.map((k) => k.toLowerCase()),
              scope: p.scope,
              conversationId: p.scope === "conversation" ? conversationId : null,
              expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
              maxFires: p.maxFires,
            },
          });
          return { ok: true, id: r.id, armed: true };
        }
        if (!p.id) return { error: "id is required" };
        const r = await db.intent.updateMany({ where: { id: p.id, botId }, data: { active: false } });
        return r.count ? { ok: true } : { error: "intent not found" };
      },
    }),
  };
}

/** Finds armed intents matching the incoming text, consumes a fire, returns reminder lines for the runtime context. */
export async function firedIntents(botId: string, conversationId: string, text: string): Promise<string[]> {
  const rows = await db.intent.findMany({ where: { botId, active: true, OR: [{ scope: "anywhere" }, { conversationId }] } });
  if (rows.length === 0) return [];
  const hay = text.toLowerCase();
  const out: string[] = [];
  const now = new Date();
  for (const r of rows) {
    if (r.expiresAt && r.expiresAt < now) {
      await db.intent.update({ where: { id: r.id }, data: { active: false } });
      continue;
    }
    const kws = Array.isArray(r.triggerKeywords) ? (r.triggerKeywords as string[]) : [];
    if (!kws.some((k) => hay.includes(k.toLowerCase()))) continue;
    const fires = r.fires + 1;
    await db.intent.update({ where: { id: r.id }, data: { fires, active: fires < r.maxFires } });
    out.push(`Standing intent fired (id ${r.id}, ${fires}/${r.maxFires}): ${r.description}`);
  }
  return out.length ? ["## Standing intents", ...out] : [];
}
