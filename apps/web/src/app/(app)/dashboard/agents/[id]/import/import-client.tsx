"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpenIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { BATCH_BYTES, BATCH_FILES, CATEGORY_LABELS, MAX_FILES, classify, normalizeRelPath, type ImportCategory, type ImportEntry, type SkippedEntry } from "@/lib/openclaw-import";

type Picked = { file: File; entry: ImportEntry };
const ORDER: ImportCategory[] = ["persona", "memory", "heartbeat", "skills", "other"];

const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function ImportClient({ botId, hasMemory }: { botId: string; hasMemory: boolean }) {
  const dirInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [skipped, setSkipped] = useState<SkippedEntry[]>([]);
  const [folderName, setFolderName] = useState("");
  const [categories, setCategories] = useState<Set<ImportCategory>>(new Set(ORDER));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [memoryMode, setMemoryMode] = useState<"append" | "replace">(hasMemory ? "append" : "replace");
  const [heartbeatAutomation, setHeartbeatAutomation] = useState(true);
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok?: boolean; error?: string; written?: { path: string }[]; skipped?: { path: string; reason: string }[]; heartbeat?: string } | null>(null);

  useEffect(() => {
    // Folder picking needs the non-standard attribute; React does not know it.
    if (dirInput.current) dirInput.current.setAttribute("webkitdirectory", "");
  }, []);

  function onPick(list: FileList | null) {
    if (!list?.length) return;
    const p: Picked[] = [];
    const s: SkippedEntry[] = [];
    let root = "";
    for (const file of Array.from(list)) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (!root && rel.includes("/")) root = rel.split("/")[0]!;
      const path = rel.includes("/") ? normalizeRelPath(rel) : rel;
      const c = classify(path, file.size);
      if (c.entry) p.push({ file, entry: c.entry });
      else if (c.skipped) s.push(c.skipped);
    }
    p.sort((a, b) => ORDER.indexOf(a.entry.category) - ORDER.indexOf(b.entry.category) || a.entry.path.localeCompare(b.entry.path));
    setPicked(p);
    setSkipped(s);
    setFolderName(root);
    setExcluded(new Set());
    setResult(null);
  }

  const groups = useMemo(() => {
    const g = new Map<ImportCategory, Picked[]>();
    for (const x of picked) g.set(x.entry.category, [...(g.get(x.entry.category) ?? []), x]);
    return g;
  }, [picked]);
  const selected = picked.filter((x) => categories.has(x.entry.category) && !excluded.has(x.entry.path));
  const selectedBytes = selected.reduce((n, x) => n + x.file.size, 0);
  const hasHeartbeat = selected.some((x) => x.entry.path === "HEARTBEAT.md");

  async function run() {
    if (!selected.length) return;
    setBusy(true);
    setResult(null);
    // Sequential batches keep every request small (no proxy upload limits, no giant form bodies).
    const batches: Picked[][] = [];
    let cur: Picked[] = [];
    let curBytes = 0;
    for (const x of selected) {
      if (cur.length >= BATCH_FILES || (curBytes + x.file.size > BATCH_BYTES && cur.length)) {
        batches.push(cur);
        cur = [];
        curBytes = 0;
      }
      cur.push(x);
      curBytes += x.file.size;
    }
    if (cur.length) batches.push(cur);
    const written: { path: string }[] = [];
    const skippedAll: { path: string; reason: string }[] = [];
    let heartbeat: string | undefined;
    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress({ done: i, total: batches.length });
        const fd = new FormData();
        fd.set("botId", botId);
        fd.set(
          "options",
          JSON.stringify({ categories: [...categories], memoryMode, heartbeatAutomation: heartbeatAutomation && hasHeartbeat, batch: { index: i, total: batches.length, totalFiles: selected.length } }),
        );
        for (const x of batches[i]!) fd.append("file", new File([x.file], x.entry.path, { type: "text/plain" }));
        const r = await fetch("/api/import/openclaw", { method: "POST", body: fd });
        const j = (await r.json()) as NonNullable<typeof result>;
        written.push(...(j?.written ?? []));
        skippedAll.push(...(j?.skipped ?? []));
        if (j?.heartbeat && j.heartbeat !== "skipped") heartbeat = j.heartbeat;
        if (!r.ok) {
          setResult({ error: `${j?.error ?? `HTTP ${r.status}`} (batch ${i + 1} of ${batches.length}; ${written.length} files were already written)`, written, skipped: skippedAll });
          return;
        }
      }
      setResult({ ok: true, written, skipped: skippedAll, heartbeat: heartbeat ?? "skipped" });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err), written, skipped: skippedAll });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (result?.ok) {
    return (
      <section className="card p-6 space-y-4">
        <p className="inline-flex items-center gap-2 font-[650]">
          <CheckCircleIcon size={20} weight="fill" className="text-accent" /> Imported {result.written?.length ?? 0} files
        </p>
        <ul className="text-sm text-fg-muted space-y-1 max-h-64 overflow-auto font-mono text-xs">
          {result.written?.map((w) => (
            <li key={w.path}>{w.path}</li>
          ))}
        </ul>
        <p className="text-sm text-fg-muted">
          Existing conversations keep their history, so the bot may still answer in its old voice there. Press <span className="font-medium text-fg">New session</span> in the web chat or send <span className="font-mono">/new</span> on Telegram to start fresh with the imported persona.
        </p>
        {result.heartbeat === "created" && <p className="text-sm text-fg-muted">A “Proactive check” automation was created; it follows HEARTBEAT.md every 30 minutes while you are idle.</p>}
        {result.heartbeat === "exists" && <p className="text-sm text-fg-muted">The existing “Proactive check” automation now follows HEARTBEAT.md.</p>}
        {!!result.skipped?.length && (
          <p className="text-xs text-fg-faint">
            {result.skipped.length} file{result.skipped.length === 1 ? "" : "s"} skipped on the server ({result.skipped.map((s) => `${s.path}: ${s.reason}`).slice(0, 5).join("; ")}
            {result.skipped.length > 5 ? "; …" : ""}).
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href={`/dashboard/agents/${botId}/chat`} className="btn-primary">
            Open web chat
          </Link>
          <Link href={`/dashboard/agents/${botId}/files`} className="btn-secondary">
            Browse workspace
          </Link>
          <Link href={`/dashboard/agents/${botId}`} className="btn-ghost">
            Bot settings
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-4">
        <div>
          <h2 className="font-[650] tracking-[-0.01em]">1. Pick the OpenClaw workspace folder</h2>
          <p className="text-sm text-fg-muted mt-1">
            Usually <span className="font-mono">~/.openclaw/workspace</span>. Nothing is uploaded yet: the files are listed in your browser first, and only the text files you keep selected are sent. Media, <span className="font-mono">.git</span>, trash and large files are skipped automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-secondary cursor-pointer">
            <FolderOpenIcon size={16} weight="bold" />
            Choose folder
            <input ref={dirInput} type="file" multiple className="sr-only" onChange={(e) => onPick(e.target.files)} />
          </label>
          <label className="btn-ghost cursor-pointer text-sm">
            or pick files
            <input type="file" multiple className="sr-only" onChange={(e) => onPick(e.target.files)} />
          </label>
          {folderName && (
            <span className="text-sm text-fg-muted">
              <span className="font-mono">{folderName}/</span> · {picked.length} importable, {skipped.length} skipped
            </span>
          )}
        </div>
      </section>

      {picked.length > 0 && (
        <section className="card p-6 space-y-5">
          <h2 className="font-[650] tracking-[-0.01em]">2. Choose what to import</h2>
          {ORDER.filter((c) => groups.has(c)).map((c) => {
            const items = groups.get(c)!;
            const on = categories.has(c);
            return (
              <div key={c} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const next = new Set(categories);
                      if (e.target.checked) next.add(c);
                      else next.delete(c);
                      setCategories(next);
                    }}
                    className="mt-1 size-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="font-medium">
                      {CATEGORY_LABELS[c].title} <span className="text-fg-faint font-normal">· {items.length}</span>
                    </span>
                    <span className="block text-sm text-fg-muted">{CATEGORY_LABELS[c].help}</span>
                  </span>
                </label>
                {on && (
                  <ul className="mt-2 ml-7 grid gap-1 sm:grid-cols-2 text-xs font-mono">
                    {items.map((x) => {
                      const off = excluded.has(x.entry.path);
                      return (
                        <li key={x.entry.path}>
                          <label className={`inline-flex items-center gap-2 cursor-pointer ${off ? "text-fg-faint line-through" : "text-fg-muted"}`}>
                            <input
                              type="checkbox"
                              checked={!off}
                              onChange={(e) => {
                                const next = new Set(excluded);
                                if (e.target.checked) next.delete(x.entry.path);
                                else next.add(x.entry.path);
                                setExcluded(next);
                              }}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                            <span className="truncate max-w-[32ch]" title={x.entry.path}>
                              {x.entry.path}
                            </span>
                            <span className="text-fg-faint">{fmt(x.file.size)}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {c === "memory" && on && items.some((x) => x.entry.path === "MEMORY.md") && (
                  <div className="mt-3 ml-7 flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="memoryMode" checked={memoryMode === "append"} onChange={() => setMemoryMode("append")} className="accent-[var(--accent)]" />
                      Append to the current MEMORY.md
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="memoryMode" checked={memoryMode === "replace"} onChange={() => setMemoryMode("replace")} className="accent-[var(--accent)]" />
                      Replace it
                    </label>
                  </div>
                )}
                {c === "heartbeat" && on && (
                  <label className="mt-3 ml-7 inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={heartbeatAutomation} onChange={(e) => setHeartbeatAutomation(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                    Create a “Proactive check” automation (every 30 min, idle only) that follows HEARTBEAT.md
                  </label>
                )}
              </div>
            );
          })}

          {skipped.length > 0 && (
            <div className="border-t border-line pt-4">
              <button type="button" className="text-sm text-fg-muted hover:text-fg underline underline-offset-4" onClick={() => setShowSkipped((v) => !v)}>
                {showSkipped ? "Hide" : "Show"} {skipped.length} skipped files
              </button>
              {showSkipped && (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-xs font-mono text-fg-faint max-h-56 overflow-auto">
                  {skipped.map((s) => (
                    <li key={s.path} className="truncate" title={`${s.path} (${s.reason})`}>
                      {s.path} <span className="text-fg-faint/70">· {s.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t border-line pt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={run} disabled={busy || !selected.length || selected.length > MAX_FILES} className="btn-primary">
              {busy ? (progress && progress.total > 1 ? `Importing… ${progress.done + 1}/${progress.total}` : "Importing…") : `Import ${selected.length} files (${fmt(selectedBytes)})`}
            </button>
            {selected.length > MAX_FILES && <span className="text-xs text-accent-ink">At most {MAX_FILES} files per import; deselect a category or some files.</span>}
            <span className="text-xs text-fg-muted">Persona files overwrite the current ones. BOOTSTRAP.md is removed, so the bot skips the first-run interview.</span>
          </div>
          {result?.error && (
            <p className="inline-flex items-center gap-2 text-sm text-accent-ink">
              <WarningCircleIcon size={16} weight="fill" /> {result.error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
