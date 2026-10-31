"use server";

import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { IMPORT_SESSION_TTL_MS, publicSession, type ImportSessionOptions, type PublicImportSession } from "@/lib/import-session";

const CATEGORIES = new Set(["persona", "memory", "heartbeat", "skills", "other"]);

/**
 * Creates a one-hour, single-use import session; the page shows the command carrying its token.
 * `botId` null = "new" mode: the script's openclaw.json creates the bot (token, model, keys).
 */
export async function createImportSession(botId: string | null, options: ImportSessionOptions): Promise<{ session?: PublicImportSession; error?: string }> {
  const user = await requireUser();
  if (botId) {
    const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
    if (!bot) return { error: "Bot not found" };
  }
  const categories = (Array.isArray(options.categories) ? options.categories : []).filter((c) => CATEGORIES.has(c));
  if (!categories.length) return { error: "Pick at least one category" };
  // Earlier unfinished sessions with the same target are superseded.
  await db.importSession.updateMany({ where: { userId: user.id, botId: botId ?? null, mode: botId ? "bot" : "new", status: { in: ["waiting", "scanning", "uploading"] } }, data: { status: "expired" } });
  const s = await db.importSession.create({
    data: {
      token: randomBytes(24).toString("hex"),
      userId: user.id,
      botId: botId ?? null,
      mode: botId ? "bot" : "new",
      options: { categories, memoryMode: options.memoryMode === "replace" ? "replace" : "append", heartbeatAutomation: !!options.heartbeatAutomation },
      expiresAt: new Date(Date.now() + IMPORT_SESSION_TTL_MS),
    },
  });
  return { session: publicSession(s) };
}

/** Latest session for a bot (or the latest "new bot" session), so a reload keeps showing a running import. */
export async function latestImportSession(botId: string | null): Promise<PublicImportSession | null> {
  const user = await requireUser();
  const s = await db.importSession.findFirst({ where: botId ? { botId, userId: user.id } : { userId: user.id, mode: "new" }, orderBy: { createdAt: "desc" } });
  return s ? publicSession(s) : null;
}
