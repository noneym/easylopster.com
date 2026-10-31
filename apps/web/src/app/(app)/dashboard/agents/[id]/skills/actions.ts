"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";
import { SKILL_TEMPLATE } from "../files/skill-template";

export type SkillRow = { slug: string; name: string; description: string; location: string; size: number };
export type SkillFormState = { error?: string; ok?: boolean } | undefined;

async function ownBot(botId: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true, userId: true } });
  if (!bot) throw new Error("Bot not found");
  return bot;
}

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

function parseFrontmatter(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { name: fm.name, description: fm.description, body: text.slice(m[0].length) };
}

/** Skills are plain workspace files: skills/<slug>/SKILL.md. Same parsing as the gateway catalog. */
export async function listSkills(botId: string): Promise<{ skills: SkillRow[]; error?: string }> {
  const bot = await ownBot(botId);
  try {
    const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/tree${q("skills")}&depth=2`);
    if (!r.ok) return { skills: [], error: r.status === 404 ? undefined : `Gateway answered ${r.status}` };
    const { entries } = (await r.json()) as { entries: { path: string; type: "file" | "dir"; size: number }[] };
    const files = entries.filter((e) => e.type === "file" && /^skills\/[^/]+\/SKILL\.md$/.test(e.path));
    const skills: SkillRow[] = [];
    for (const f of files) {
      const fr = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(f.path)}`);
      const j = (await fr.json()) as { content?: string };
      const fm = parseFrontmatter(j.content ?? "");
      const slug = f.path.split("/")[1]!;
      skills.push({
        slug,
        name: (fm.name ?? slug).slice(0, 64),
        description: (fm.description ?? fm.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "").slice(0, 400),
        location: f.path,
        size: f.size,
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return { skills };
  } catch (err) {
    return { skills: [], error: `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Use a lowercase slug: letters, digits, dashes");

export async function createSkill(_prev: SkillFormState, formData: FormData): Promise<SkillFormState> {
  const botId = String(formData.get("botId") ?? "");
  const bot = await ownBot(botId);
  const parsed = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(64) }).safeParse({ slug: formData.get("slug"), name: formData.get("name") || formData.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const rel = `skills/${parsed.data.slug}/SKILL.md`;
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(rel)}`, { method: "PUT", body: SKILL_TEMPLATE(parsed.data.name), headers: { "content-type": "text/plain; charset=utf-8" } }).catch(() => null);
  if (!r || !r.ok) return { error: "Could not write the skill file (gateway unreachable?)" };
  revalidatePath(`/dashboard/agents/${botId}/skills`);
  redirect(`/dashboard/agents/${botId}/files?path=${encodeURIComponent(rel)}`);
}

export async function importSkill(_prev: SkillFormState, formData: FormData): Promise<SkillFormState> {
  const botId = String(formData.get("botId") ?? "");
  const bot = await ownBot(botId);
  const parsed = z.object({ url: z.string().trim().url("Enter the raw URL of a SKILL.md"), slug: slugSchema.optional().or(z.literal("")) }).safeParse({ url: formData.get("url"), slug: formData.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { url } = parsed.data;
  if (!/^https?:\/\//i.test(url)) return { error: "Only http(s) URLs" };
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "text/plain, text/markdown, */*" } });
    if (!res.ok) return { error: `The URL answered HTTP ${res.status}` };
    text = (await res.text()).slice(0, 40_000);
  } catch (err) {
    return { error: `Could not fetch: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!text.trim() || /^\s*</.test(text)) return { error: "That does not look like a Markdown file. Use the raw file URL." };
  const fm = parseFrontmatter(text);
  const guess = (fm.name ?? url.split("/").filter((x) => x && !/^SKILL\.md$/i.test(x)).pop() ?? "skill").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "skill";
  const slug = parsed.data.slug || guess;
  const firstLine = (fm.body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "Imported skill").trim().slice(0, 200);
  const body = fm.name ? text : `---\nname: ${guess}\ndescription: ${firstLine}\n---\n\n${text}`;
  const rel = `skills/${slug}/SKILL.md`;
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(rel)}`, { method: "PUT", body: body.trim() + "\n", headers: { "content-type": "text/plain; charset=utf-8" } }).catch(() => null);
  if (!r || !r.ok) return { error: "Could not write the skill file (gateway unreachable?)" };
  revalidatePath(`/dashboard/agents/${botId}/skills`);
  return { ok: true };
}

export async function deleteSkill(botId: string, slug: string) {
  const bot = await ownBot(botId);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return;
  await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(`skills/${slug}`)}`, { method: "DELETE" }).catch(() => null);
  revalidatePath(`/dashboard/agents/${botId}/skills`);
}
