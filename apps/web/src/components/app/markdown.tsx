import { markdownToTelegramHtml } from "@easylopster/shared/markdown";

/**
 * Renders assistant Markdown. The converter escapes all input and only emits a fixed set of tags
 * (b, i, s, code, pre, a[href=https], blockquote, tg-spoiler), so the HTML is safe to inject.
 */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = markdownToTelegramHtml(text)
    .replace(/<tg-spoiler>/g, '<span class="spoiler">')
    .replace(/<\/tg-spoiler>/g, "</span>")
    .replace(/<a href="/g, '<a target="_blank" rel="noreferrer" class="underline underline-offset-4" href="');
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
