import { generateText } from "ai";
import { botScope } from "../account-scope.ts";
import { db } from "@easylopster/db";
import { resolveModel } from "./providers.ts";
import { Workspace } from "../workspace/fs.ts";

/**
 * Dreaming (OpenClaw background consolidation): once a day, promote durable facts from the last
 * days' memory notes into MEMORY.md and log the review in DREAMS.md. Runs at 04:00 in the owner's
 * timezone; one tick per hour is enough.
 */
const DREAM_HOUR = 4;
const LOOKBACK_DAYS = 3;
const log = (m: string) => console.log(`[dreaming] ${new Date().toISOString()} ${m}`);

const SYSTEM = `Nightly memory consolidation. You are given the current MEMORY.md (curated long-term memory) and the last days' daily notes. Output ONLY new bullet lines worth keeping long-term that are NOT already in MEMORY.md: stable facts about the owner, preferences, decisions, recurring context, important ids/paths. Skip transient todos, one-off chatter and anything already present. If nothing qualifies reply exactly NO_REPLY.`;

function localHour(tz: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
}
function localDay(tz: string, offsetDays = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - offsetDays * 86_400_000));
}

export async function dreamForBot(botId: string): Promise<"done" | "skipped" | "nothing"> {
  const bot = await db.bot.findUnique({ where: { id: botId }, include: { providerKey: true, user: { select: { timezone: true } } } });
  if (!bot?.providerKey) return "skipped";
  const tz = bot.user.timezone || "UTC";
  const ws = new Workspace(bot.userId, bot.id);
  await ws.ensure();
  const notes: string[] = [];
  for (let d = 0; d < LOOKBACK_DAYS; d++) {
    const rel = `memory/${localDay(tz, d)}.md`;
    const t = await ws.readOptional(rel);
    if (t) notes.push(`### ${rel}\n${t.slice(0, 12_000)}`);
  }
  if (notes.length === 0) return "nothing";
  const memory = (await ws.readOptional("MEMORY.md")) ?? "";
  const resolved = resolveModel(bot.providerKey, bot.model || bot.providerKey.defaultModel, "off");
  const r = await generateText({ model: resolved.model, system: SYSTEM, prompt: `# MEMORY.md (current)\n${memory.slice(0, 20_000) || "(empty)"}\n\n# Daily notes\n${notes.join("\n\n")}`, maxRetries: 1 });
  const text = r.text.trim();
  const today = localDay(tz);
  if (!text || text.toUpperCase() === "NO_REPLY") {
    await ws.append("DREAMS.md", `- ${today}: reviewed ${notes.length} day(s), nothing new to promote\n`);
    return "nothing";
  }
  const fresh = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-") && !memory.includes(l.replace(/^-\s*/, "")))
    .join("\n");
  if (!fresh) return "nothing";
  await ws.append("MEMORY.md", `${memory ? "\n" : "# MEMORY\n\n"}## Promoted ${today}\n${fresh}\n`);
  await ws.append("DREAMS.md", `- ${today}: promoted ${fresh.split("\n").length} item(s) from ${notes.length} day(s) of notes\n`);
  return "done";
}

/** Hourly check: dream for every bot whose local time passed DREAM_HOUR and that has not dreamed today. */
export function startDreaming(): () => void {
  const tick = async () => {
    try {
      const bots = await db.bot.findMany({ where: { status: "active", dreaming: true, providerKeyId: { not: null }, ...botScope() }, include: { user: { select: { timezone: true } } } });
      for (const b of bots) {
        const tz = b.user.timezone || "UTC";
        if (localHour(tz) < DREAM_HOUR) continue;
        const today = localDay(tz);
        const last = b.lastDreamAt ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(b.lastDreamAt) : null;
        if (last === today) continue;
        await db.bot.update({ where: { id: b.id }, data: { lastDreamAt: new Date() } });
        const r = await dreamForBot(b.id).catch((e) => `error ${(e as Error).message}`);
        log(`bot=${b.id} ${r}`);
      }
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }
  };
  setTimeout(() => void tick(), 30_000);
  const t = setInterval(() => void tick(), 60 * 60_000);
  return () => clearInterval(t);
}
