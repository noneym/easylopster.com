import { mkdir, readFile, readdir, stat, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.ts";

/**
 * Cloud workspace: one directory per bot under WORKSPACE_ROOT/<userId>/<botId>.
 * Every path from the model is resolved and jailed inside that directory.
 */
export class Workspace {
  readonly root: string;

  constructor(userId: string, botId: string) {
    this.root = path.resolve(env().WORKSPACE_ROOT, userId, botId);
  }

  async ensure() {
    await mkdir(path.join(this.root, "memory"), { recursive: true });
  }

  resolve(rel: string): string {
    const clean = rel.replace(/^[\\/]+/, "").replace(/^~\/?/, "");
    const abs = path.resolve(this.root, clean);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes the workspace: ${rel}`);
    }
    return abs;
  }

  async read(rel: string, maxChars = 60_000): Promise<string> {
    const text = await readFile(this.resolve(rel), "utf8");
    return text.length > maxChars ? text.slice(0, maxChars) + `\n\n[...truncated, ${text.length} chars total]` : text;
  }

  async readOptional(rel: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(rel), "utf8");
    } catch {
      return null;
    }
  }

  async write(rel: string, content: string) {
    const abs = this.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  async append(rel: string, content: string) {
    const abs = this.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await appendFile(abs, content, "utf8");
  }

  async list(rel = ".", depth = 2): Promise<{ path: string; type: "file" | "dir"; size: number }[]> {
    const out: { path: string; type: "file" | "dir"; size: number }[] = [];
    const walk = async (dir: string, d: number) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const abs = path.join(dir, e.name);
        const relPath = path.relative(this.root, abs).split(path.sep).join("/");
        if (e.isDirectory()) {
          out.push({ path: relPath + "/", type: "dir", size: 0 });
          if (d > 0) await walk(abs, d - 1);
        } else {
          const s = await stat(abs).catch(() => null);
          out.push({ path: relPath, type: "file", size: s?.size ?? 0 });
        }
        if (out.length >= 500) return;
      }
    };
    await walk(this.resolve(rel), depth);
    return out;
  }

  /** Case-insensitive substring/regex search across text files. */
  async search(query: string, opts: { regex?: boolean; maxResults?: number } = {}): Promise<{ path: string; line: number; text: string }[]> {
    const max = opts.maxResults ?? 40;
    const re = opts.regex ? new RegExp(query, "i") : null;
    const needle = query.toLowerCase();
    const hits: { path: string; line: number; text: string }[] = [];
    const files = (await this.list(".", 6)).filter((f) => f.type === "file" && f.size < 2_000_000);
    for (const f of files) {
      const text = await readFile(this.resolve(f.path), "utf8").catch(() => null);
      if (text == null || text.includes("\0")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!;
        if (re ? re.test(l) : l.toLowerCase().includes(needle)) {
          hits.push({ path: f.path, line: i + 1, text: l.trim().slice(0, 300) });
          if (hits.length >= max) return hits;
        }
      }
    }
    return hits;
  }

  /** memory/YYYY-MM-DD.md in the user's timezone. */
  dailyMemoryPath(now: Date, timezone: string): string {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return `memory/${day}.md`;
  }
}
