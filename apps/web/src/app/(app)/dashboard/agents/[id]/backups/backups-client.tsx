"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveIcon, ArrowCounterClockwiseIcon, DownloadSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { SaveButton } from "@/components/app/save-button";
import { useToast } from "@/components/app/toaster";
import { backupDownloadUrl, backupNow, deleteBackupAction, restoreBackupAction, saveBackupPolicy, type BackupFormState } from "./actions";

type Policy = { enabled: boolean; kind: "daily" | "hours" | "weekly"; time: string; hours: number; weekday: number; retentionDays: number | null; keepLast: number; includeConversations: boolean; includeInbox: boolean; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null };
type BackupRow = { id: string; key: string; bytes: number; trigger: string; createdAt: string; manifest: { files?: number; conversations?: number } | null };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "—");

export function BackupsClient({ botId, timezone, hasStorage, storageLabel, policy, backups }: { botId: string; timezone: string; hasStorage: boolean; storageLabel: string | null; policy: Policy | null; backups: BackupRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState<BackupFormState, FormData>(saveBackupPolicy, undefined);
  const [kind, setKind] = useState<Policy["kind"]>(policy?.kind ?? "daily");
  const [busy, start] = useTransition();
  const [running, setRunning] = useState(false);
  const fe = state?.fieldErrors ?? {};

  const run = () => {
    setRunning(true);
    start(async () => {
      const r = await backupNow(botId);
      setRunning(false);
      if (r.error) return toast.push("error", r.error);
      toast.push("success", `Backup written: ${r.files ?? "?"} files, ${fmt(r.bytes ?? 0)}.`);
      router.refresh();
    });
  };
  const download = (id: string) =>
    start(async () => {
      const r = await backupDownloadUrl(id);
      if (r.error || !r.url) return toast.push("error", r.error ?? "No link");
      window.open(r.url, "_blank", "noopener");
    });
  const restore = (b: BackupRow, settings: boolean) => {
    if (!confirm(`Restore the workspace from the backup of ${when(b.createdAt)}?${settings ? " The agent's settings and automations are restored too." : ""}\n\nFiles with the same names are overwritten; other files stay.`)) return;
    start(async () => {
      const r = await restoreBackupAction(b.id, settings);
      if (r.error) return toast.push("error", r.error);
      toast.push("success", `Restored ${r.files ?? 0} files${settings ? " and the settings" : ""}. Start a new session so the agent reads the restored persona.`);
      router.refresh();
    });
  };
  const remove = (b: BackupRow) => {
    if (!confirm(`Delete the backup of ${when(b.createdAt)}? This removes the archive from your storage.`)) return;
    start(async () => {
      const r = await deleteBackupAction(b.id);
      if (r.error) return toast.push("error", r.error);
      toast.push("success", "Backup deleted.");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
      <section className="space-y-6">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line">
            <div>
              <h2 className="font-[650] tracking-[-0.01em]">Backups</h2>
              <p className="text-xs text-fg-muted mt-0.5">{storageLabel ? <span className="font-mono">{storageLabel}</span> : "no storage connected"}</p>
            </div>
            <button type="button" className="btn-primary h-9" onClick={run} disabled={!hasStorage || running || busy}>
              <ArchiveIcon size={16} weight="bold" /> {running ? "Backing up…" : "Back up now"}
            </button>
          </div>
          {backups.length === 0 ? (
            <p className="px-5 py-10 text-sm text-fg-muted text-center">No backups yet. Press “Back up now” or save a schedule.</p>
          ) : (
            <ul className="divide-y divide-line">
              {backups.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{when(b.createdAt)}</p>
                    <p className="text-xs text-fg-muted">
                      {fmt(b.bytes)} · {b.manifest?.files ?? "?"} files{b.manifest?.conversations ? ` · ${b.manifest.conversations} conversations` : ""} · {b.trigger}
                    </p>
                  </div>
                  <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => download(b.id)} disabled={busy}>
                    <DownloadSimpleIcon size={14} /> Download
                  </button>
                  <button type="button" className="btn-secondary h-8 px-2 text-xs" onClick={() => restore(b, false)} disabled={busy}>
                    <ArrowCounterClockwiseIcon size={14} /> Restore files
                  </button>
                  <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => restore(b, true)} disabled={busy}>
                    + settings
                  </button>
                  <button type="button" className="btn-ghost h-8 px-2 text-xs text-accent-ink" onClick={() => remove(b)} disabled={busy} aria-label="Delete backup">
                    <TrashIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-xs text-fg-muted">
          An archive holds <span className="font-mono">workspace/</span> (persona, memory, skills, scripts), <span className="font-mono">settings.json</span> (model, policies, automations, allowlist; secret values are never included) and optionally <span className="font-mono">conversations.json</span>. You can also download it and open it like any zip.
        </p>
      </section>

      <form action={action} className="card p-5 space-y-4" noValidate onReset={(e) => e.preventDefault()}>
        <input type="hidden" name="botId" value={botId} />
        <div>
          <h2 className="font-[650] tracking-[-0.01em]">Schedule</h2>
          <p className="text-xs text-fg-muted mt-0.5">Times are in your time zone ({timezone}).</p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? true} className="size-4 accent-[var(--accent)]" />
          <span className="font-medium">Scheduled backups on</span>
        </label>
        <div>
          <label htmlFor="kind" className="label">
            Frequency
          </label>
          <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as Policy["kind"])} className="input">
            <option value="daily">Every day at a time</option>
            <option value="weekly">Once a week</option>
            <option value="hours">Every N hours</option>
          </select>
        </div>
        {kind !== "hours" && (
          <div className="grid grid-cols-2 gap-3">
            {kind === "weekly" && (
              <div>
                <label htmlFor="weekday" className="label">
                  Day
                </label>
                <select id="weekday" name="weekday" defaultValue={policy?.weekday ?? 0} className="input">
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="time" className="label">
                Time
              </label>
              <input id="time" name="time" type="time" defaultValue={policy?.time ?? "03:00"} className="input" />
              {fe.time && <p className="error">{fe.time}</p>}
            </div>
          </div>
        )}
        {kind === "hours" && (
          <div>
            <label htmlFor="hours" className="label">
              Every … hours
            </label>
            <input id="hours" name="hours" type="number" min={1} max={168} defaultValue={policy?.hours ?? 6} className="input" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="retentionDays" className="label">
              Delete after (days)
            </label>
            <input id="retentionDays" name="retentionDays" type="number" min={1} max={3650} defaultValue={policy?.retentionDays ?? 7} className="input" placeholder="keep forever" />
            <p className="help">Empty = never delete by age.</p>
          </div>
          <div>
            <label htmlFor="keepLast" className="label">
              Always keep last
            </label>
            <input id="keepLast" name="keepLast" type="number" min={0} max={1000} defaultValue={policy?.keepLast ?? 3} className="input" />
            <p className="help">Newest N survive the age rule.</p>
          </div>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="includeConversations" defaultChecked={policy?.includeConversations ?? false} className="mt-1 size-4 accent-[var(--accent)]" />
          <span className="text-sm">
            <span className="font-medium">Include conversations</span>
            <span className="block text-fg-muted">Every chat as JSON. Bigger archives.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" name="includeInbox" defaultChecked={policy?.includeInbox ?? false} className="mt-1 size-4 accent-[var(--accent)]" />
          <span className="text-sm">
            <span className="font-medium">Include inbox/</span>
            <span className="block text-fg-muted">Photos, documents and downloads the agent received.</span>
          </span>
        </label>
        {state?.error && <p className="text-sm text-accent-ink">{state.error}</p>}
        <SaveButton pending={pending} state={state}>
          Save schedule
        </SaveButton>
        {policy && (
          <p className="text-xs text-fg-muted border-t border-line pt-3">
            Next run: {when(policy.nextRunAt)} · Last: {when(policy.lastRunAt)}
            {policy.lastStatus ? ` (${policy.lastStatus})` : ""}
            {policy.lastError ? <span className="block text-accent-ink">{policy.lastError}</span> : null}
          </p>
        )}
      </form>
    </div>
  );
}
