import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * web_search: Brave Search when BRAVE_API_KEY is set, otherwise DuckDuckGo's HTML endpoint
 * (no key, best effort). Returns normalized {title, url, snippet} results.
 */
interface Result {
  title: string;
  url: string;
  snippet: string;
}

async function brave(query: string, count: number, freshness?: string): Promise<Result[]> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(count));
  if (freshness) u.searchParams.set("freshness", { day: "pd", week: "pw", month: "pm", year: "py" }[freshness] ?? "");
  const r = await fetch(u, { headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY!, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Brave answered ${r.status}`);
  const j = (await r.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (j.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.description ?? "" }));
}

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function duckduckgo(query: string, count: number): Promise<Result[]> {
  const r = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; easylopster/0.1; +https://easylopster.com)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`DuckDuckGo answered ${r.status}`);
  const html = await r.text();
  const out: Result[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < count) {
    let url = m[1]!;
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]!);
    out.push({ title: decode(m[2]!), url, snippet: decode(m[3]!) });
  }
  return out;
}

export function webSearchTools(): ToolSet {
  return {
    web_search: tool({
      description: "Search the current web; returns normalized results (title, url, snippet). Use web_fetch on a result to read it. Supports a freshness filter (day/week/month/year).",
      inputSchema: z.object({
        query: z.string().min(1).max(300),
        count: z.number().int().min(1).max(10).default(5),
        freshness: z.enum(["day", "week", "month", "year"]).optional(),
      }),
      execute: async ({ query, count, freshness }) => {
        try {
          const results = process.env.BRAVE_API_KEY ? await brave(query, count, freshness) : await duckduckgo(query, count);
          return { provider: process.env.BRAVE_API_KEY ? "brave" : "duckduckgo", results };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
