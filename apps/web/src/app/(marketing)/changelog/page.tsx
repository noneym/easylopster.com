import type { ReactNode } from "react";
import { CHANGELOG_MD } from "@/generated/changelog";

export const metadata = { title: "Changelog", description: "What changed in easylopster, release by release." };

/** Minimal renderer for our own Keep-a-Changelog Markdown: headings, bullets, bold, code, links. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else {
      const lm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      out.push(
        <a key={k++} href={lm[2]} className="underline underline-offset-4 hover:text-fg" target={lm[2]!.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          {lm[1]}
        </a>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Release = { version: string; date?: string; blocks: { kind: "h3" | "p" | "ul"; text?: string; items?: string[] }[] };

function parse(md: string): { intro: string[]; releases: Release[] } {
  const lines = md.split("\n");
  const releases: Release[] = [];
  const intro: string[] = [];
  let cur: Release | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length && cur) cur.blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^\[[^\]]+\]:\s*http/.test(line)) continue; // link reference definitions
    const h2 = line.match(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/);
    if (h2) {
      flush();
      cur = { version: h2[1]!, date: h2[2], blocks: [] };
      releases.push(cur);
      continue;
    }
    if (!cur) {
      if (line.trim() && !line.startsWith("#")) intro.push(line);
      continue;
    }
    const h3 = line.match(/^### (.+)/);
    if (h3) {
      flush();
      cur.blocks.push({ kind: "h3", text: h3[1] });
      continue;
    }
    const li = line.match(/^- (.+)/);
    if (li) {
      flush();
      const lastBlock = cur.blocks[cur.blocks.length - 1];
      if (lastBlock?.kind === "ul") lastBlock.items!.push(li[1]!);
      else cur.blocks.push({ kind: "ul", items: [li[1]!] });
      continue;
    }
    if (/^\s+\S/.test(line)) {
      // continuation of a wrapped bullet or paragraph
      const lastBlock = cur.blocks[cur.blocks.length - 1];
      if (!para.length && lastBlock?.kind === "ul") lastBlock.items![lastBlock.items!.length - 1] += " " + line.trim();
      else para.push(line.trim());
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return { intro, releases: releases.filter((r) => r.version !== "Unreleased" || r.blocks.length > 0) };
}

export default function ChangelogPage() {
  const { releases } = parse(CHANGELOG_MD);
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16 md:py-24">
      <p className="eyebrow mb-4">changelog</p>
      <h1 className="text-4xl md:text-5xl leading-[1.02]">What changed.</h1>
      <p className="mt-4 text-fg-muted max-w-[58ch] leading-relaxed">
        Every release, from the <a href="https://github.com/noneym/easylopster.com/blob/main/CHANGELOG.md" className="underline underline-offset-4 hover:text-fg" target="_blank" rel="noreferrer">repository changelog</a>. Semantic versions; tags on GitHub carry the installers and images.
      </p>
      <div className="mt-14 space-y-14">
        {releases.map((r) => (
          <article key={r.version} id={`v${r.version}`} className="grid gap-4 md:grid-cols-[140px_1fr] scroll-mt-24">
            <header className="md:sticky md:top-24 self-start">
              <h2 className="text-2xl">{r.version === "Unreleased" ? "Unreleased" : `v${r.version}`}</h2>
              {r.date && <p className="font-mono text-xs text-fg-muted mt-1">{r.date}</p>}
            </header>
            <div className="space-y-4 text-[15px] leading-relaxed">
              {r.blocks.map((b, i) =>
                b.kind === "h3" ? (
                  <h3 key={i} className="eyebrow pt-2">
                    {b.text}
                  </h3>
                ) : b.kind === "p" ? (
                  <p key={i} className="text-fg-muted">
                    {inline(b.text!)}
                  </p>
                ) : (
                  <ul key={i} className="space-y-2">
                    {b.items!.map((it, j) => (
                      <li key={j} className="pl-4 relative text-fg-muted before:absolute before:left-0 before:top-[0.7em] before:size-1.5 before:rounded-full before:bg-accent">
                        {inline(it)}
                      </li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
