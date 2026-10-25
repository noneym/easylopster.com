"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpIcon, WrenchIcon } from "@phosphor-icons/react";
import { decideWebApproval, listWebMessages, resetWebConversation, sendWebMessage } from "./actions";
import { Markdown } from "@/components/app/markdown";

type Msg = { id: string; role: "user" | "assistant"; text: string; error?: string | null };
type Approval = { id: string; target?: string; preview?: string; status: string; canAlways?: boolean };

export function ChatClient({ botId, conversationId: initialConv, initial, initialBusy = false, initialContext }: { botId: string; conversationId: string; initial: Msg[]; initialBusy?: boolean; initialContext?: { used: number; window: number } | null }) {
  const [context, setContext] = useState(initialContext ?? null);
  const [conversationId, setConversationId] = useState(initialConv);
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(initialBusy);
  const [tool, setTool] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    const es = new EventSource(`/api/chat/${conversationId}/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { type: string; text?: string; name?: string; status?: string; message?: string; messageId?: string; id?: string; target?: string; preview?: string; canAlways?: boolean; context?: { used: number; window: number } };
      if (ev.type === "delta") {
        setStreamText(ev.text ?? "");
      } else if (ev.type === "approval" && ev.id) {
        setApprovals((prev) => {
          const i = prev.findIndex((a) => a.id === ev.id);
          const next: Approval = { id: ev.id!, target: ev.target ?? prev[i]?.target, preview: ev.preview ?? prev[i]?.preview, status: ev.status ?? "pending", canAlways: ev.canAlways ?? prev[i]?.canAlways };
          return i >= 0 ? prev.map((a) => (a.id === ev.id ? next : a)) : [...prev, next];
        });
      } else if (ev.type === "tool") {
        setTool(ev.status === "start" ? ev.name ?? "tool" : null);
      } else if (ev.type === "final") {
        if (ev.context) setContext(ev.context);
        const final: Msg = { id: ev.messageId ?? `m-${Date.now()}`, role: "assistant", text: ev.text ?? "" };
        setMessages((prev) => (prev.some((m) => m.id === final.id) || !ev.text ? prev : [...prev, final]));
        setStreamText("");
        setTool(null);
        setBusy(false);
      } else if (ev.type === "error") {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", text: "", error: ev.message }]);
        setStreamText("");
        setTool(null);
        setBusy(false);
      }
    };
    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, tool, streamText, approvals]);

  // Catch-up poll while a reply is pending: if the SSE stream missed the final event (reconnect, dev
  // route compile, tab in background) the stored messages still arrive.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const lastStored = [...messages].reverse().find((m) => !m.id.startsWith("u-") && !m.id.startsWith("err-") && m.id !== "kickoff");
      const r = await listWebMessages(botId, conversationId, lastStored?.id).catch(() => null);
      if (!r) return;
      const fresh = r.messages.filter((m) => m.role === "assistant" && (m.text || m.error));
      if (fresh.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...fresh.filter((m) => !seen.has(m.id)).map((m) => ({ id: m.id, role: m.role, text: m.text, error: m.error }))];
        });
      }
      const failedUser = r.messages.find((m) => m.role === "user" && m.error);
      if (failedUser) setMessages((prev) => (prev.some((m) => m.id === `err-${failedUser.id}`) ? prev : [...prev, { id: `err-${failedUser.id}`, role: "assistant", text: "", error: failedUser.error }]));
      if (!r.busy) {
        setStreamText("");
        setTool(null);
        setBusy(false);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [busy, messages, botId, conversationId]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    start(async () => {
      const r = await sendWebMessage(botId, conversationId, text);
      if (r && "error" in r && r.error) {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: "assistant", text: "", error: r.error }]);
        setBusy(false);
      }
    });
  }

  function reset() {
    start(async () => {
      await resetWebConversation(botId, conversationId);
      // A fresh conversation gets created on the next page load; simplest is to reload.
      location.reload();
    });
    setConversationId(conversationId);
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.length === 0 && <p className="text-sm text-fg-muted">Say hello. This web session is separate from Telegram conversations.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.error ? (
              <div className="max-w-[85%] rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm">{m.error}</div>
            ) : (
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] rounded-lg rounded-br-sm bg-accent text-accent-fg px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap"
                    : "max-w-[85%] rounded-lg rounded-bl-sm bg-bg-sunk px-3.5 py-2 text-sm leading-relaxed"
                }
              >
                {m.role === "user" ? m.text : <Markdown text={m.text} className="whitespace-pre-wrap" />}
              </div>
            )}
          </div>
        ))}
        {approvals.map((a) => (
          <div key={a.id} className="flex justify-start">
            <div className="max-w-[85%] rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm">
              <p className="font-medium">Approval needed · {a.target}</p>
              <pre className="mt-1 font-mono text-xs whitespace-pre-wrap break-all">{a.preview}</pre>
              {a.status === "pending" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn-primary h-8" onClick={() => start(async () => void (await decideWebApproval(botId, a.id, "approved")))}>
                    Allow once
                  </button>
                  {a.canAlways && (
                    <button type="button" className="btn-secondary h-8" title="Never ask again for this action on this node" onClick={() => start(async () => void (await decideWebApproval(botId, a.id, "always")))}>
                      Always allow
                    </button>
                  )}
                  <button type="button" className="btn-secondary h-8" onClick={() => start(async () => void (await decideWebApproval(botId, a.id, "denied")))}>
                    Deny
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-fg-muted capitalize">{a.status}</p>
              )}
            </div>
          </div>
        ))}
        {streamText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-bg-sunk px-3.5 py-2 text-sm leading-relaxed">
              <Markdown text={streamText} className="whitespace-pre-wrap" />
              <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-fg-faint animate-pulse" />
            </div>
          </div>
        )}
        {busy && !streamText && (
          <div className="flex justify-start" aria-live="polite">
            <div className="inline-flex items-center gap-2.5 rounded-lg rounded-bl-sm bg-bg-sunk px-3.5 py-2.5 text-sm text-fg-muted">
              {tool ? (
                <>
                  <WrenchIcon size={14} className="text-accent-ink" />
                  <span>
                    Running <span className="font-mono text-fg">{tool}</span>
                  </span>
                </>
              ) : (
                <span>Thinking</span>
              )}
              <span className="inline-flex gap-1" aria-hidden>
                <span className="size-1.5 rounded-full bg-fg-faint animate-bounce [animation-delay:-0.3s]" />
                <span className="size-1.5 rounded-full bg-fg-faint animate-bounce [animation-delay:-0.15s]" />
                <span className="size-1.5 rounded-full bg-fg-faint animate-bounce" />
              </span>
            </div>
          </div>
        )}
        {tool && streamText && (
          <p className="inline-flex items-center gap-2 text-xs text-fg-muted font-mono">
            <WrenchIcon size={12} /> {tool}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t border-line py-4 flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Message"
          className="input h-auto min-h-10 max-h-40 py-2 resize-y"
          aria-label="Message"
        />
        <button type="submit" disabled={busy || pending || !draft.trim()} aria-label="Send" className="btn-primary size-10 px-0! shrink-0">
          <ArrowUpIcon size={18} weight="bold" />
        </button>
        <button type="button" onClick={reset} className="btn-ghost h-10 shrink-0 text-sm">
          New session
        </button>
      </form>
      {context && context.window > 0 && <ContextGauge used={context.used} window={context.window} onCompact={reset} />}
    </>
  );
}

/** "Context 42% · 108k / 256k" with a nudge once the window is getting full. */
function ContextGauge({ used, window: win, onCompact }: { used: number; window: number; onCompact: () => void }) {
  const pct = Math.min(100, Math.round((used / win) * 100));
  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const hot = pct >= 80;
  return (
    <div className="flex items-center gap-3 pb-3 text-xs text-fg-muted">
      <span className="font-mono">
        context {pct}% · {fmt(used)} / {fmt(win)}
      </span>
      <span className="h-1.5 w-28 rounded-full bg-bg-sunk overflow-hidden" aria-hidden>
        <span className={`block h-full ${hot ? "bg-accent" : "bg-fg-faint"}`} style={{ width: `${pct}%` }} />
      </span>
      {hot && (
        <span>
          Getting full; the bot compacts automatically, or{" "}
          <button type="button" onClick={onCompact} className="underline underline-offset-4 hover:text-fg">
            start a new session
          </button>
          .
        </span>
      )}
    </div>
  );
}
