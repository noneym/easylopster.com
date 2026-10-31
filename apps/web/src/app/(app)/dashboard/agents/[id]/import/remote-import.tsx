"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwiseIcon, CheckCircleIcon, CheckIcon, CopyIcon, DesktopIcon, KeyIcon, RobotIcon, TerminalWindowIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { CATEGORY_LABELS, type ImportCategory } from "@/lib/openclaw-import";
import type { ImportSessionOptions, PublicImportSession } from "@/lib/import-session";
import { useToast } from "@/components/app/toaster";
import { createImportSession } from "./actions";
import { FinishSetup, type KeyChoice } from "./finish-setup";

const ORDER: ImportCategory[] = ["persona", "memory", "heartbeat", "skills", "other"];
const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const LIVE = new Set(["waiting", "scanning", "uploading"]);

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost h-8 px-2 text-xs shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {}
      }}
      aria-label="Copy command"
    >
      {ok ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />} {ok ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * "Run a command on the OpenClaw machine" import. With a `botId` the files go into that bot; with
 * `botId` null the script's openclaw.json also creates the bot (Telegram token, model, API keys).
 * The page watches the upload arrive, step by step, with the files grouped by category.
 */
export function RemoteImport({ botId, origin, hasMemory, initial, keys = [] }: { botId: string | null; origin: string; hasMemory: boolean; initial: PublicImportSession | null; keys?: KeyChoice[] }) {
  const toast = useToast();
  const isNew = botId === null;
  const [categories, setCategories] = useState<Set<ImportCategory>>(new Set(ORDER));
  const [memoryMode, setMemoryMode] = useState<"append" | "replace">(hasMemory ? "append" : "replace");
  const [heartbeatAutomation, setHeartbeatAutomation] = useState(true);
  const [importKeys, setImportKeys] = useState(true);
  const [importTelegram, setImportTelegram] = useState(true);
  const [session, setSession] = useState<PublicImportSession | null>(initial && (LIVE.has(initial.status) || initial.status === "done" || initial.status === "failed") ? initial : null);
  const [creating, setCreating] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Poll while the script is expected to be running; the status changes drive the visualization.
  useEffect(() => {
    if (!session || !LIVE.has(session.status)) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/import/session/${session.id}`, { cache: "no-store" }).catch(() => null);
      if (!r || !r.ok || stop) return;
      const j = (await r.json()) as PublicImportSession;
      setSession(j);
      if (j.status === "done") toast.push("success", `Imported ${j.result?.written.length ?? 0} files from ${j.hostname ?? "the OpenClaw machine"}.`);
      if (j.status === "failed") toast.push("error", j.error || "The import failed.");
    };
    const t = setInterval(tick, 1500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(t);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  async function generate() {
    setCreating(true);
    const opts: ImportSessionOptions = { categories: [...categories], memoryMode, heartbeatAutomation, importKeys, importTelegram };
    const r = await createImportSession(botId, opts).catch((e: Error) => ({ error: e.message }));
    setCreating(false);
    if ("error" in r && r.error) return toast.push("error", r.error);
    if ("session" in r && r.session) setSession(r.session);
  }

  const bash = session ? `curl -fsSL ${origin}/import.sh | bash -s -- ${session.token}` : "";
  const ps = session ? `$env:EASYLOPSTER_IMPORT_TOKEN="${session.token}"; irm ${origin}/import.ps1 | iex` : "";
  const status = session?.status ?? "idle";
  const step = status === "waiting" ? 1 : status === "scanning" ? 2 : status === "uploading" ? 3 : status === "done" || status === "failed" ? 4 : 0;
  const writtenSet = useMemo(() => new Set((session?.result?.written ?? []).map((w) => w.path)), [session?.result]);
  const skippedMap = useMemo(() => new Map((session?.result?.skipped ?? []).map((s) => [s.path, s.reason])), [session?.result]);
  const byCat = useMemo(() => {
    const m = new Map<ImportCategory, { count: number; bytes: number; written: number }>();
    for (const e of session?.manifest?.entries ?? []) {
      const c = m.get(e.category) ?? { count: 0, bytes: 0, written: 0 };
      c.count++;
      c.bytes += e.size;
      if (writtenSet.has(e.path)) c.written++;
      m.set(e.category, c);
    }
    return m;
  }, [session?.manifest, writtenSet]);
  const maxCat = Math.max(1, ...[...byCat.values()].map((c) => c.count));
  const progress = session?.progress;
  const pct = progress && progress.filesTotal ? Math.round((progress.filesDone / progress.filesTotal) * 100) : 0;
  const expiresIn = session ? Math.max(0, Math.round((new Date(session.expiresAt).getTime() - now) / 60_000)) : 0;
  const created = session?.created ?? null;
  const targetBot = session?.botId ?? botId;

  if (!session) {
    return (
      <section className="card p-6 space-y-5">
        <div>
          <h2 className="font-[650] tracking-[-0.01em]">{isNew ? "1. What to bring over" : "1. Choose what to import"}</h2>
          <p className="text-sm text-fg-muted mt-1">
            {isNew
              ? "The command reads openclaw.json on that machine (bot name, Telegram token, model, API keys) and creates the bot here, then uploads the workspace categories you pick. Everything is shown live on this page."
              : "The command you get next only uploads the categories you pick here; the file list is shown live on this page while it runs."}
          </p>
        </div>
        {isNew && (
          <div className="space-y-3">
            <p className="label">From openclaw.json</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={importKeys} onChange={(e) => setImportKeys(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
              <span>
                <span className="font-medium">Import API keys (agent tokens)</span>
                <span className="block text-sm text-fg-muted">Provider keys from openclaw.json, the usual env variables or OpenClaw's auth profiles are tested and added to your account; the bot uses the one matching its model. Unchecked, the keys never leave the machine and the bot uses a key you already have here.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={importTelegram} onChange={(e) => setImportTelegram(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
              <span>
                <span className="font-medium">Import Telegram token</span>
                <span className="block text-sm text-fg-muted">The bot token from openclaw.json puts the bot on Telegram here (stop the OpenClaw instance first; two programs cannot receive the same bot's messages). Unchecked, the bot starts as web chat only.</span>
              </span>
            </label>
            <p className="label pt-2">From the workspace</p>
          </div>
        )}
        {ORDER.map((c) => (
          <label key={c} className={`flex items-start gap-3 cursor-pointer border-t border-line pt-4 ${isNew ? "" : "first:border-t-0 first:pt-0"}`}>
            <input
              type="checkbox"
              checked={categories.has(c)}
              onChange={(e) => {
                const next = new Set(categories);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                setCategories(next);
              }}
              className="mt-1 size-4 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium">{CATEGORY_LABELS[c].title}</span>
              <span className="block text-sm text-fg-muted">{CATEGORY_LABELS[c].help}</span>
              {c === "memory" && categories.has(c) && !isNew && (
                <span className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="rMemoryMode" checked={memoryMode === "append"} onChange={() => setMemoryMode("append")} className="accent-[var(--accent)]" />
                    Append to the current MEMORY.md
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="rMemoryMode" checked={memoryMode === "replace"} onChange={() => setMemoryMode("replace")} className="accent-[var(--accent)]" />
                    Replace it
                  </label>
                </span>
              )}
              {c === "heartbeat" && categories.has(c) && (
                <label className="mt-2 inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={heartbeatAutomation} onChange={(e) => setHeartbeatAutomation(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  Create a “Proactive check” automation (every 30 min, idle only) that follows HEARTBEAT.md
                </label>
              )}
            </span>
          </label>
        ))}
        <div className="border-t border-line pt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={generate} disabled={creating || !categories.size} className="btn-primary">
            <TerminalWindowIcon size={16} weight="bold" /> {creating ? "Preparing…" : "Get the command"}
          </button>
          <span className="text-xs text-fg-muted">The command is valid for one hour and works once.</span>
        </div>
      </section>
    );
  }

  const steps = [
    { n: 1, title: "Command ready", body: "Run it on the OpenClaw machine" },
    { n: 2, title: session.hostname ? `Connected: ${session.hostname}` : "Connected", body: created ? `Bot “${created.name}” created` : (session.workspace ?? "Reading the workspace") },
    { n: 3, title: "Uploading", body: progress ? `${progress.filesDone} / ${progress.filesTotal} files · ${fmt(progress.bytesDone)}` : "Waiting for files" },
    { n: 4, title: status === "failed" ? "Failed" : "Done", body: status === "done" ? `${session.result?.written.length ?? 0} files imported` : status === "failed" ? (session.error ?? "") : "Writing into the bot's workspace" },
  ];

  return (
    <div className="space-y-6">
      {LIVE.has(status) && (
        <section className="card p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-[650] tracking-[-0.01em]">2. Run this on the machine where OpenClaw lives</h2>
              <p className="text-sm text-fg-muted mt-1">
                It finds <span className="font-mono">~/.openclaw</span> (openclaw.json and the workspace), lists the files, and uploads only the categories you picked
                {isNew ? "; the Telegram token, model and API keys are used to create the bot" : ""}. Nothing else leaves the machine. Add <span className="font-mono">--workspace /path</span> if the workspace lives elsewhere.
              </p>
            </div>
            <span className="text-xs text-fg-faint whitespace-nowrap">expires in {expiresIn} min</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="label mb-1.5">macOS / Linux</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 min-w-0 overflow-x-auto rounded-md border border-line bg-bg-sunk px-3 py-2.5 text-[12.5px] leading-relaxed font-mono">
                  <code>{bash}</code>
                </pre>
                <CopyButton text={bash} />
              </div>
            </div>
            <div>
              <p className="label mb-1.5">Windows (PowerShell)</p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 min-w-0 overflow-x-auto rounded-md border border-line bg-bg-sunk px-3 py-2.5 text-[12.5px] leading-relaxed font-mono">
                  <code>{ps}</code>
                </pre>
                <CopyButton text={ps} />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card p-6 space-y-6" aria-live="polite">
        <ol className="grid gap-4 grid-cols-2 min-[1700px]:grid-cols-4">
          {steps.map((s) => {
            const state = s.n < step ? "done" : s.n === step ? (status === "failed" && s.n === 4 ? "failed" : LIVE.has(status) ? "active" : "done") : "todo";
            return (
              <li key={s.n} className="flex gap-3">
                <span
                  className={`mt-0.5 size-7 shrink-0 rounded-full grid place-items-center text-xs font-semibold ${
                    state === "done" ? "bg-emerald-600 text-white" : state === "failed" ? "bg-accent text-white" : state === "active" ? "bg-accent-soft text-accent-ink ring-2 ring-accent/40 animate-pulse" : "bg-bg-sunk text-fg-faint"
                  }`}
                >
                  {state === "done" ? <CheckIcon size={14} weight="bold" /> : state === "failed" ? "!" : s.n}
                </span>
                <span className="min-w-0">
                  <span className={`block font-medium ${state === "todo" ? "text-fg-faint" : ""}`}>{s.title}</span>
                  <span className="block text-xs text-fg-muted truncate" title={s.body}>
                    {s.body}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        {status === "waiting" && (
          <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
            <DesktopIcon size={16} /> Waiting for the command to run… this page updates by itself.
          </p>
        )}

        {created && (
          <div className="rounded-md border border-line bg-bg-sunk/60 p-4 space-y-3">
            <p className="inline-flex items-center gap-2 font-medium">
              <RobotIcon size={18} className="text-accent-ink" /> {created.name}
              <span className="text-xs font-normal text-fg-muted">{created.platform === "telegram" ? `Telegram · @${created.tgUsername ?? "?"}` : "web chat only"}{created.model ? ` · ${created.model}` : ""}</span>
            </p>
            {created.keys.length > 0 && (
              <ul className="text-sm space-y-1">
                {created.keys.map((k, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <KeyIcon size={14} className={`mt-1 shrink-0 ${k.status === "failed" || k.status === "unsupported" ? "text-accent-ink" : "text-emerald-600"}`} />
                    <span>
                      <span className="font-medium">{k.label}</span> <span className="text-fg-muted">· {k.status === "created" ? "key added" : k.status === "existing" ? "already on your account" : k.status === "failed" ? `rejected: ${k.detail}` : k.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {created.notes.length > 0 && (
              <ul className="text-xs text-fg-muted space-y-1 list-disc pl-4">
                {created.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {progress && progress.filesTotal > 0 && (
          <div>
            <div className="flex justify-between text-xs text-fg-muted mb-1.5">
              <span>
                {progress.filesDone} of {progress.filesTotal} files · {fmt(progress.bytesDone)} of {fmt(progress.bytesTotal)}
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-bg-sunk overflow-hidden">
              <div className={`h-full rounded-full transition-[width] duration-500 ${status === "failed" ? "bg-accent" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {byCat.size > 0 && (
          <div className="space-y-2">
            <p className="label">By category</p>
            {ORDER.filter((c) => byCat.has(c)).map((c) => {
              const v = byCat.get(c)!;
              return (
                <div key={c} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{CATEGORY_LABELS[c].title}</span>
                  <div className="h-2.5 rounded-full bg-bg-sunk overflow-hidden relative">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-accent/25" style={{ width: `${(v.count / maxCat) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-600 transition-[width] duration-500" style={{ width: `${(v.written / maxCat) * 100}%` }} />
                  </div>
                  <span className="text-xs text-fg-muted tabular-nums whitespace-nowrap">
                    {v.written}/{v.count} · {fmt(v.bytes)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!!session.manifest?.entries.length && (
          <div>
            <p className="label mb-2">Files</p>
            <ul className="grid gap-1 sm:grid-cols-2 text-xs font-mono max-h-72 overflow-auto">
              {session.manifest.entries.slice(0, 600).map((e) => {
                const w = writtenSet.has(e.path);
                const reason = skippedMap.get(e.path);
                return (
                  <li key={e.path} className={`flex items-center gap-2 min-w-0 ${w ? "text-fg" : reason ? "text-fg-faint" : "text-fg-muted"}`} title={reason ? `${e.path}: ${reason}` : e.path}>
                    {w ? <CheckIcon size={12} weight="bold" className="shrink-0 text-emerald-600" /> : reason ? <WarningCircleIcon size={12} className="shrink-0 text-accent-ink" /> : <span className="size-3 shrink-0 rounded-full border border-line" />}
                    <span className="truncate">{e.path}</span>
                    <span className="ml-auto shrink-0 text-fg-faint">{reason ? reason : fmt(e.size)}</span>
                  </li>
                );
              })}
            </ul>
            {session.manifest.entries.length > 600 && <p className="text-xs text-fg-faint mt-1">… and {session.manifest.entries.length - 600} more</p>}
            {!!session.manifest.skipped.length && (
              <div className="mt-3">
                <button type="button" className="text-xs text-fg-muted hover:text-fg underline underline-offset-4" onClick={() => setShowSkipped((v) => !v)}>
                  {showSkipped ? "Hide" : "Show"} {session.manifest.skipped.length} files left on the machine
                </button>
                {showSkipped && (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-xs font-mono text-fg-faint max-h-56 overflow-auto">
                    {session.manifest.skipped.slice(0, 600).map((s) => (
                      <li key={s.path} className="truncate" title={`${s.path} (${s.reason})`}>
                        {s.path} <span className="text-fg-faint/70">· {s.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {status === "done" && isNew && created && targetBot && (created.needsKey || created.platform === "web") && (
          <FinishSetup botId={targetBot} keys={keys} needsKey={!!created.needsKey} wantedModel={created.wantedModel ?? created.model ?? null} tgUsername={created.platform === "telegram" ? (created.tgUsername ?? null) : null} />
        )}
        {status === "done" && (
          <div className="border-t border-line pt-4 space-y-3">
            <p className="inline-flex items-center gap-2 font-[650]">
              <CheckCircleIcon size={20} weight="fill" className="text-emerald-600" /> Imported {session.result?.written.length ?? 0} files from {session.hostname ?? "the OpenClaw machine"}
            </p>
            <p className="text-sm text-fg-muted">
              {isNew ? "The bot is ready; say hello in the web chat. " : "Existing conversations keep their history, so the bot may still answer in its old voice there. Press "}
              {!isNew && <span className="font-medium text-fg">New session</span>}
              {!isNew && " in the web chat or send "}
              {!isNew && <span className="font-mono">/new</span>}
              {!isNew && " on Telegram to start fresh with the imported persona."}
            </p>
            {session.result?.heartbeat === "created" && <p className="text-sm text-fg-muted">A “Proactive check” automation was created; it follows HEARTBEAT.md every 30 minutes while you are idle.</p>}
            {session.result?.heartbeat === "exists" && <p className="text-sm text-fg-muted">The existing “Proactive check” automation now follows HEARTBEAT.md.</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {targetBot && (
                <Link href={`/dashboard/agents/${targetBot}/chat`} className="btn-primary">
                  Open web chat
                </Link>
              )}
              {targetBot && (
                <Link href={`/dashboard/agents/${targetBot}`} className="btn-secondary">
                  Bot settings
                </Link>
              )}
              <button type="button" className="btn-ghost" onClick={() => setSession(null)}>
                <ArrowsClockwiseIcon size={16} /> Import again
              </button>
            </div>
          </div>
        )}
        {(status === "failed" || status === "expired") && (
          <div className="border-t border-line pt-4 space-y-3">
            <p className="inline-flex items-center gap-2 text-sm text-accent-ink">
              <WarningCircleIcon size={16} weight="fill" /> {status === "expired" ? "The command expired before it was run." : session.error || "The import failed."}
              {status === "failed" && !!session.result?.written.length && <span className="text-fg-muted">({session.result.written.length} files were already written.)</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSession(null)}>
                <ArrowsClockwiseIcon size={16} /> New command
              </button>
              {targetBot && created && (
                <Link href={`/dashboard/agents/${targetBot}`} className="btn-ghost">
                  Open the created bot
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
