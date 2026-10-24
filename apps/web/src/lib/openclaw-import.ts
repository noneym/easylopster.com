/**
 * Shared rules for importing an OpenClaw workspace folder. Pure functions used by the picker
 * (browser) and the import route (server): both must agree on what is importable.
 */
export type ImportCategory = "persona" | "memory" | "heartbeat" | "skills" | "other";

export interface ImportEntry {
  /** Path relative to the workspace root, forward slashes */
  path: string;
  size: number;
  category: ImportCategory;
}

export interface SkippedEntry {
  path: string;
  size: number;
  reason: string;
}

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** Hard cap for one import (all batches together). */
export const MAX_FILES = 2000;
/** Files per request; the picker splits a large import into sequential batches. */
export const BATCH_FILES = 120;
export const BATCH_BYTES = 8 * 1024 * 1024;

const PERSONA = new Set(["SOUL.md", "USER.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md"]);
const SKIP_DIRS = /^(\.git|\.trash[^/]*|\.openclaw|\.clawhub|node_modules|\.venv|venv|__pycache__|\.cache|dist|build)(\/|$)/;
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|csv|tsv|py|js|mjs|cjs|ts|tsx|sh|bash|zsh|ps1|bat|cmd|sql|html?|css|xml|ini|cfg|conf|env\.example|log)$/i;
const BINARY_EXT = /\.(mp4|mov|mkv|avi|webm|mp3|wav|m4a|ogg|flac|png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|tar|gz|tgz|7z|rar|exe|dll|so|dylib|bin|part|ytdl|sqlite|db|woff2?|ttf|otf)$/i;

export function normalizeRelPath(p: string): string {
  // Folder pickers prefix the chosen directory name; strip it. Archives use "workspace/x" too.
  const clean = p.replace(/\\/g, "/").replace(/^\.?\//, "");
  const parts = clean.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : clean;
}

export function classify(relPath: string, size: number): { entry?: ImportEntry; skipped?: SkippedEntry } {
  const path = relPath;
  const name = path.split("/").pop() ?? path;
  if (!path || path.endsWith("/")) return { skipped: { path, size, reason: "folder" } };
  if (SKIP_DIRS.test(path)) return { skipped: { path, size, reason: "internal folder" } };
  if (name === "BOOTSTRAP.md") return { skipped: { path, size, reason: "first-run file, not needed" } };
  if (name === "NO_REPLY" || name.startsWith(".tmp")) return { skipped: { path, size, reason: "scratch file" } };
  if (BINARY_EXT.test(name)) return { skipped: { path, size, reason: "binary / media" } };
  if (size > MAX_FILE_BYTES) return { skipped: { path, size, reason: `larger than ${MAX_FILE_BYTES / 1024} KB` } };
  if (size === 0) return { skipped: { path, size, reason: "empty" } };
  if (!TEXT_EXT.test(name) && !/^[A-Z_]+(\.md)?$/.test(name) && !name.startsWith(".")) return { skipped: { path, size, reason: "unknown file type" } };
  if (name.startsWith(".") && !TEXT_EXT.test(name)) return { skipped: { path, size, reason: "hidden file" } };

  let category: ImportCategory = "other";
  if (!path.includes("/") && PERSONA.has(name)) category = "persona";
  else if (path === "MEMORY.md" || /^memory\/.+\.md$/.test(path)) category = "memory";
  else if (path === "HEARTBEAT.md") category = "heartbeat";
  else if (/^skills\/[^/]+\/.+/.test(path)) category = "skills";
  return { entry: { path, size, category } };
}

export const CATEGORY_LABELS: Record<ImportCategory, { title: string; help: string }> = {
  persona: { title: "Persona", help: "SOUL.md, USER.md, IDENTITY.md, AGENTS.md, TOOLS.md: who the bot is and who you are. Replaces the current files." },
  memory: { title: "Memory", help: "MEMORY.md and memory/YYYY-MM-DD.md daily notes. MEMORY.md is appended to the existing one unless you choose replace." },
  heartbeat: { title: "Heartbeat", help: "HEARTBEAT.md: the checklist the bot runs on its proactive check. Optionally creates the matching automation." },
  skills: { title: "Skills", help: "skills/<name>/SKILL.md procedures and their helper files." },
  other: { title: "Scripts and notes", help: "Other text files in the workspace (scripts, notes, configs). Imported with the same paths; the bot can run them on a node or in the sandbox." },
};
