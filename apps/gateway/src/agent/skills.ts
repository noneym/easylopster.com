import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Workspace } from "../workspace/fs.ts";

/**
 * Workspace skills: skills/<name>/SKILL.md with optional YAML-ish frontmatter (name, description).
 * Mirrors OpenClaw's catalog: the prompt lists name/description/location; the model reads the file
 * on demand with skill_read (or fs_read) when a task matches.
 */
export interface SkillInfo {
  name: string;
  description: string;
  location: string; // relative path inside the workspace
}

const MAX_SKILLS = 150;
const MAX_CATALOG_CHARS = 18_000;

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

export async function loadSkills(ws: Workspace): Promise<SkillInfo[]> {
  const entries = await ws.list("skills", 1).catch(() => []);
  const dirs = entries.filter((e) => e.type === "dir" && /^skills\/[^/]+\/$/.test(e.path));
  const skills: SkillInfo[] = [];
  for (const d of dirs) {
    const rel = `${d.path}SKILL.md`;
    const text = await ws.readOptional(rel);
    if (!text) continue;
    const fm = parseFrontmatter(text);
    const name = (fm.name ?? d.path.slice(7, -1)).slice(0, 64);
    const description = (fm.description ?? fm.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "").slice(0, 400);
    skills.push({ name, description, location: rel });
    if (skills.length >= MAX_SKILLS) break;
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function skillsCatalog(skills: SkillInfo[], workspaceDir: string): string {
  if (skills.length === 0) return "";
  const render = (list: SkillInfo[], compact: boolean) =>
    [
      "The following skills provide specialized instructions for specific tasks.",
      `Read a skill's file at its listed location when the task matches its ${compact ? "name" : "description"}.`,
      "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md).",
      "",
      "<available_skills>",
      ...list.map((s) => `  <skill>\n    <name>${esc(s.name)}</name>\n    <description>${esc(compact ? s.description.slice(0, 220) : s.description)}</description>\n    <location>${workspaceDir}/${s.location}</location>\n  </skill>`),
      "</available_skills>",
    ].join("\n");
  let out = render(skills, false);
  if (out.length > MAX_CATALOG_CHARS) out = render(skills, true);
  if (out.length > MAX_CATALOG_CHARS) out = render(skills.slice(0, Math.max(5, Math.floor((skills.length * MAX_CATALOG_CHARS) / out.length))), true) + `\n⚠️ Skills truncated: showing a subset of ${skills.length}.`;
  return out;
}

export function skillTools(ws: Workspace, skills: SkillInfo[]): ToolSet {
  return {
    skill_read: tool({
      description: "Read a skill's SKILL.md (full instructions) by name. Use when the current task matches a listed skill; then follow it.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        const s = skills.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? skills.find((x) => x.location.toLowerCase().includes(name.toLowerCase()));
        if (!s) return { error: `No skill named ${name}. Available: ${skills.map((x) => x.name).join(", ") || "none"}` };
        return { name: s.name, location: s.location, content: await ws.read(s.location, 40_000) };
      },
    }),
    skill_save: tool({
      description:
        "Create or update a reusable skill from what you learned: writes skills/<slug>/SKILL.md with frontmatter (name, description) and step-by-step instructions. Use after completing a non-trivial workflow the user may ask for again, or when the user asks you to remember how to do something.",
      inputSchema: z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase slug"),
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(300).describe("One line: when to use this skill"),
        instructions: z.string().min(1).max(20_000).describe("Markdown body: steps, commands, gotchas"),
      }),
      execute: async ({ slug, name, description, instructions }) => {
        const rel = `skills/${slug}/SKILL.md`;
        await ws.write(rel, `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n${instructions.trim()}\n`);
        return { ok: true, path: rel };
      },
    }),
  };
}
