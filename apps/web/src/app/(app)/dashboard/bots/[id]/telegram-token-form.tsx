"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TelegramLogoIcon } from "@phosphor-icons/react";
import { useToast } from "@/components/app/toaster";
import { removeTelegramToken, setTelegramToken } from "../actions";

/**
 * Connect a bot to Telegram, change its token, or take it off Telegram again. Used on the bot
 * page (Manage) and in the import's "Finish setup" step.
 */
export function TelegramTokenForm({ botId, tgUsername, compact = false, onChanged }: { botId: string; tgUsername: string | null; compact?: boolean; onChanged?: (username: string | null) => void }) {
  const toast = useToast();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(!tgUsername);
  const [pending, start] = useTransition();
  const [showHow, setShowHow] = useState(false);

  const save = () =>
    start(async () => {
      const r = await setTelegramToken(botId, token.trim()).catch((e: Error) => ({ error: e.message }));
      if ("error" in r && r.error) return toast.push("error", r.error);
      if ("username" in r) {
        toast.push("success", `Connected to Telegram as @${r.username}.${r.webhookWarning ? ` ${r.webhookWarning}` : ""}`);
        setToken("");
        setEditing(false);
        onChanged?.(r.username ?? null);
        router.refresh();
      }
    });
  const remove = () =>
    start(async () => {
      const r = await removeTelegramToken(botId).catch((e: Error) => ({ error: e.message }));
      if ("error" in r && r.error) return toast.push("error", r.error);
      toast.push("success", "Telegram disconnected; the bot keeps working in the web chat.");
      setEditing(true);
      onChanged?.(null);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {!compact && (
        <div>
          <h2 className="font-semibold tracking-tight inline-flex items-center gap-2">
            <TelegramLogoIcon size={18} className="text-accent-ink" /> Telegram
          </h2>
          <p className="text-sm text-fg-muted mt-0.5">
            {tgUsername ? (
              <>
                Connected as <span className="font-mono text-fg">@{tgUsername}</span>. Paste a new token to switch this bot to another Telegram bot (its chats and pairings stay), or disconnect to keep it web-only.
              </>
            ) : (
              "This bot answers in the web chat only. Paste a BotFather token to put it on Telegram; we verify it, register the webhook and the command menu."
            )}
          </p>
        </div>
      )}
      {editing || !tgUsername ? (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} className="input font-mono flex-1" placeholder="123456789:AAH…" aria-label="Telegram bot token" />
            <button type="button" onClick={save} disabled={pending || token.trim().length < 20} className="btn-primary shrink-0">
              {pending ? "Verifying…" : tgUsername ? "Switch token" : "Connect Telegram"}
            </button>
            {tgUsername && (
              <button type="button" className="btn-ghost shrink-0" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-fg-muted">
            Stop the OpenClaw (or any other) instance that still uses this token first; Telegram delivers a bot's messages to one place only.{" "}
            <button type="button" className="underline underline-offset-4 text-fg" onClick={() => setShowHow((v) => !v)}>
              {showHow ? "Hide" : "How do I get a token?"}
            </button>
          </p>
          {showHow && (
            <ol className="rounded-md border border-line bg-bg-sunk px-4 py-3 text-xs text-fg-muted list-decimal pl-8 space-y-1">
              <li>
                In Telegram open{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline underline-offset-4 text-fg">
                  @BotFather
                </a>{" "}
                and send <span className="font-mono">/newbot</span> (or <span className="font-mono">/token</span> for an existing bot).
              </li>
              <li>
                Pick a display name and a username ending in <span className="font-mono">bot</span>.
              </li>
              <li>
                Copy the token it answers with (<span className="font-mono">123456789:AAH…</span>) and paste it above.
              </li>
            </ol>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Change token
          </button>
          <button type="button" className="btn-ghost text-accent-ink" onClick={remove} disabled={pending}>
            {pending ? "Working…" : "Disconnect Telegram"}
          </button>
        </div>
      )}
    </div>
  );
}
