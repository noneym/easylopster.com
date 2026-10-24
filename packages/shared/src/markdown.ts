/**
 * Markdown → Telegram HTML (parse_mode: "HTML"), following OpenClaw's mapping:
 * bold <b>, italic <i>, strike <s>, inline code <code>, fences <pre><code class="language-x">,
 * links <a href>, headings as bold lines, lists as bullets, blockquote <blockquote>.
 * Falls back to plain text when Telegram rejects the entities.
 */

export const TELEGRAM_TEXT_CHUNK_LIMIT = 4000;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(md: string): string {
  // Protect inline code first
  const codes: string[] = [];
  let s = md.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|tg:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, "&quot;")}">${t}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_\n]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  s = s.replace(/\|\|([^|\n]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]!);
  return s;
}

export function markdownToTelegramHtml(md: string): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) buf.push(lines[i++]!);
      i++; // closing fence
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      out.push(`<b>${inline(heading[1]!)}</b>`);
      i++;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const buf = [quote[1]!];
      i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${buf.map(inline).join("\n")}</blockquote>`);
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      out.push(`${bullet[1]!.length ? "  " : ""}• ${inline(bullet[2]!)}`);
      i++;
      continue;
    }
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      out.push(`${ordered[1]!.length ? "  " : ""}${ordered[2]}. ${inline(ordered[3]!)}`);
      i++;
      continue;
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      out.push("");
      i++;
      continue;
    }
    // Markdown tables → monospace block (OpenClaw "code" mode)
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const row = lines[i++]!;
        if (/^\s*\|[\s:|-]+\|\s*$/.test(row)) continue;
        buf.push(row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" | "));
      }
      out.push(`<pre>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    out.push(inline(line));
    i++;
  }
  // Collapse 3+ blank lines to 2
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Split rendered HTML into chunks ≤ limit, preferring paragraph then line boundaries, and
 * re-opening <pre><code> blocks across boundaries so each chunk is valid on its own.
 */
export function splitTelegramHtml(html: string, limit = TELEGRAM_TEXT_CHUNK_LIMIT): string[] {
  if (html.length <= limit) return [html];
  const chunks: string[] = [];
  let rest = html;
  let openPre: string | null = null;
  while (rest.length > 0) {
    let take = rest.length <= limit ? rest.length : -1;
    if (take === -1) {
      const window = rest.slice(0, limit);
      take = window.lastIndexOf("\n\n");
      if (take < limit * 0.4) take = window.lastIndexOf("\n");
      if (take < limit * 0.4) take = window.lastIndexOf(" ");
      if (take < limit * 0.4) take = limit;
    }
    let piece = rest.slice(0, take);
    rest = rest.slice(take).replace(/^\n+/, "");
    if (openPre) piece = openPre + piece;
    // Track unclosed <pre>
    const opens = piece.match(/<pre>(<code[^>]*>)?/g)?.length ?? 0;
    const closes = piece.match(/<\/code><\/pre>|<\/pre>/g)?.length ?? 0;
    if (opens > closes) {
      const m = piece.match(/<pre>(<code[^>]*>)?(?![\s\S]*<\/pre>)/);
      openPre = m ? m[0] : "<pre>";
      piece += openPre.includes("<code") ? "</code></pre>" : "</pre>";
    } else {
      openPre = null;
    }
    if (piece.trim()) chunks.push(piece);
  }
  return chunks;
}
