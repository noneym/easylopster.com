"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpIcon, WrenchIcon } from "@phosphor-icons/react";
import { resetWebConversation, sendWebMessage } from "./actions";
import { Markdown } from "@/components/app/markdown";

type Msg = { id: string; role: "user" | "assistant"; text: string; error?: string | null };

export function ChatClient({ botId, conversationId: initialConv, initial }: { botId: string; conversationId: string; initial: Msg[] }) {
  const [conversationId, setConversationId] = useState(initialConv);
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    esRef.current?.close();
    const es = new EventSource(`/api/chat/${conversationId}/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { type: string; text?: string; name?: string; status?: string; message?: string; messageId?: string };
      if (ev.type === "delta") {
        setStreamText(ev.text ?? "");
      } else if (ev.type === "tool") {
        setTool(ev.status === "start" ? ev.name ?? "tool" : null);
      } else if (ev.type === "final") {
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
  }, [messages, tool, streamText]);

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
        {streamText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg rounded-bl-sm bg-bg-sunk px-3.5 py-2 text-sm leading-relaxed">
              <Markdown text={streamText} className="whitespace-pre-wrap" />
              <span className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-fg-faint animate-pulse" />
            </div>
          </div>
        )}
        {tool && (
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
        <button type="submit" disabled={busy || pending || !draft.trim()} aria-label="Send" className="btn-primary size-10 px-0 shrink-0">
          <ArrowUpIcon size={18} weight="bold" />
        </button>
        <button type="button" onClick={reset} className="btn-ghost h-10 shrink-0 text-sm">
          New session
        </button>
      </form>
    </>
  );
}
