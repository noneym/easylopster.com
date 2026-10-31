"use client";

import { useActionState, useState, useTransition } from "react";
import { SaveButton } from "@/components/app/save-button";
import { addHeartbeat, createAutomation, deleteAutomation, runAutomationNow, toggleAutomation, type AutomationFormState } from "./actions";

export type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  prompt: string;
  sessionTarget: string;
  idleOnly: boolean;
  createdBy: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastResult: string | null;
  lastError: string | null;
  runCount: number;
};

export function AutomationsSection({ botId, rows, hasHeartbeat, hasOwnerChat }: { botId: string; rows: AutomationRow[]; hasHeartbeat: boolean; hasOwnerChat: boolean }) {
  const [state, action, pending] = useActionState<AutomationFormState, FormData>(createAutomation, undefined);
  const [kind, setKind] = useState<"every" | "cron" | "at">("every");
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const fmt = (s: string | null) => (s ? s.replace("T", " ").slice(0, 16) + " UTC" : "–");

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold tracking-tight">Automations</h2>
          <p className="text-sm text-fg-muted mt-0.5">Scheduled turns: reminders, recurring checks, one-shot wakeups. Replies go to your Telegram DM{hasOwnerChat ? "" : " once you have messaged the bot"}; NO_REPLY stays silent.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {!hasHeartbeat && (
            <button type="button" className="btn-secondary h-9" onClick={() => start(() => addHeartbeat(botId))}>
              Add heartbeat
            </button>
          )}
          <button type="button" className="btn-primary h-9" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "New automation"}
          </button>
        </div>
      </div>

      {open && (
        <form action={action} className="mt-5 grid gap-4 border-t border-line pt-5" noValidate>
          <input type="hidden" name="botId" value={botId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="a-name" className="label">
                Name
              </label>
              <input id="a-name" name="name" className="input" placeholder="Morning briefing" required />
            </div>
            <div>
              <label htmlFor="a-kind" className="label">
                Schedule
              </label>
              <div className="flex gap-2">
                <select id="a-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as never)} className="input w-36 shrink-0">
                  <option value="every">Every</option>
                  <option value="cron">Cron</option>
                  <option value="at">Once at</option>
                </select>
                {kind === "every" && <input name="everyMin" type="number" min={1} defaultValue={30} className="input" aria-label="minutes" />}
                {kind === "cron" && <input name="cron" className="input font-mono text-sm" placeholder="0 9 * * 1-5" aria-label="cron expression" />}
                {kind === "at" && <input name="at" type="datetime-local" className="input" aria-label="date and time" />}
              </div>
              <p className="help">{kind === "every" ? "Minutes between runs." : kind === "cron" ? "5 fields, in your time zone." : "Fires once, then disables itself."}</p>
            </div>
          </div>
          <div>
            <label htmlFor="a-prompt" className="label">
              Message the bot receives
            </label>
            <textarea id="a-prompt" name="prompt" rows={3} className="input h-auto py-2" placeholder="Summarize what changed in my notes since yesterday and list today's open tasks." required />
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <select name="sessionTarget" defaultValue="main" className="input h-8 w-auto">
                <option value="main">Main session (with history)</option>
                <option value="isolated">Isolated session</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="idleOnly" className="size-4 accent-[var(--accent)]" /> Skip while I'm chatting
            </label>
          </div>
          <div className="flex items-center gap-3">
            <SaveButton pending={pending} state={state} pendingLabel="Creating" savedLabel="Created" success="Created. First run at the next slot.">
              Create
            </SaveButton>
            {state?.error && <span className="text-sm text-accent-ink">{state.error}</span>}
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No automations yet. The bot can also create them itself with the automations tool ("remind me tomorrow at 9").</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`font-medium ${a.enabled ? "" : "text-fg-muted line-through"}`}>{a.name}</span>
                <span className="text-xs text-fg-muted font-mono">{a.schedule}</span>
                {a.idleOnly && <span className="text-xs text-fg-faint">idle only</span>}
                {a.sessionTarget === "isolated" && <span className="text-xs text-fg-faint">isolated</span>}
                {a.createdBy === "agent" && <span className="text-xs text-fg-faint">by bot</span>}
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn-ghost h-7 text-xs" onClick={() => start(() => runAutomationNow(botId, a.id))}>
                    Run now
                  </button>
                  <button type="button" className="btn-ghost h-7 text-xs" onClick={() => start(() => toggleAutomation(botId, a.id, !a.enabled))}>
                    {a.enabled ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="btn-ghost h-7 text-xs text-accent-ink" onClick={() => confirm(`Delete ${a.name}?`) && start(() => deleteAutomation(botId, a.id))}>
                    Delete
                  </button>
                </span>
              </div>
              <p className="mt-1 text-sm text-fg-muted line-clamp-2">{a.prompt}</p>
              <p className="mt-1 text-xs text-fg-faint">
                next {fmt(a.nextRunAt)} · last {fmt(a.lastRunAt)} {a.lastStatus ? `(${a.lastStatus})` : ""} · runs {a.runCount}
                {a.lastError ? ` · ${a.lastError}` : ""}
              </p>
              {a.lastResult && a.lastStatus === "ok" && <p className="mt-1 text-xs text-fg-muted line-clamp-2">↳ {a.lastResult}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
