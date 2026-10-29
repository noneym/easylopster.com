import { Api, GrammyError } from "grammy";
import { htmlToPlainText, markdownToTelegramHtml, splitTelegramHtml } from "./format.ts";

/**
 * Outbound Telegram helpers over grammY's Api (no polling). HTML parse mode with a plain-text
 * fallback, 4000-char chunking, typing keepalive, and a throttled draft editor for streaming.
 */
/** "node_bravepc_browser_open" → "bravepc › browser_open"; other tools keep their name. */
export function prettyToolName(name: string): string {
  const m = name.match(/^node_([a-z0-9]+)_(.+)$/i);
  return m ? `${m[1]} › ${m[2]}` : name;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export class TelegramSender {
  readonly api: Api;
  constructor(token: string) {
    this.api = new Api(token);
  }

  private async withPlainFallback<T>(html: string, send: (text: string, parseMode?: "HTML") => Promise<T>): Promise<T> {
    try {
      return await send(html, "HTML");
    } catch (err) {
      if (err instanceof GrammyError && /can't parse entities|message text is empty|entities/i.test(err.description)) {
        return await send(htmlToPlainText(html));
      }
      throw err;
    }
  }

  async sendMarkdown(chatId: string | number, markdown: string, opts: { threadId?: number; replyTo?: number } = {}): Promise<number[]> {
    const html = markdownToTelegramHtml(markdown);
    const chunks = splitTelegramHtml(html);
    const ids: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const m = await this.withPlainFallback(chunks[i]!, (text, parse_mode) =>
        this.api.sendMessage(chatId, text, {
          parse_mode,
          message_thread_id: opts.threadId && opts.threadId !== 1 ? opts.threadId : undefined,
          reply_parameters: i === 0 && opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
          link_preview_options: { is_disabled: true },
        }),
      );
      ids.push(m.message_id);
    }
    return ids;
  }

  async sendText(chatId: string | number, text: string, opts: { threadId?: number; replyTo?: number; html?: boolean } = {}) {
    return this.api.sendMessage(chatId, text, {
      parse_mode: opts.html ? "HTML" : undefined,
      message_thread_id: opts.threadId && opts.threadId !== 1 ? opts.threadId : undefined,
      reply_parameters: opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
      link_preview_options: { is_disabled: true },
    });
  }

  /** Keeps the "typing…" indicator alive (Telegram expires it after 5 s; OpenClaw re-sends every 4 s). */
  typing(chatId: string | number, threadId?: number): () => void {
    const send = () => this.api.sendChatAction(chatId, "typing", { message_thread_id: threadId && threadId !== 1 ? threadId : undefined }).catch(() => {});
    void send();
    const timer = setInterval(send, 4000);
    const stop = () => clearInterval(timer);
    setTimeout(stop, 120_000);
    return stop;
  }

  async react(chatId: string | number, messageId: number, emoji: string) {
    await this.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: emoji as never }]).catch(() => {});
  }

  /**
   * "block" streaming: every paragraph that is complete (a blank line follows it, outside code
   * fences) is sent as its own message while the model is still writing; finish() sends whatever
   * paragraphs of the final text were not sent yet. Nothing is edited, nothing is deleted.
   */
  blockStream(chatId: string | number, opts: { threadId?: number; replyTo?: number } = {}) {
    const self = this;
    let sentParagraphs = 0;
    let inflight: Promise<void> = Promise.resolve();
    let stopped = false;
    const sendPara = (p: string, first: boolean) => {
      inflight = inflight.then(async () => {
        await self.sendMarkdown(chatId, p, { threadId: opts.threadId, replyTo: first ? opts.replyTo : undefined }).catch(() => {});
      });
      return inflight;
    };
    return {
      update(text: string) {
        if (stopped) return;
        const done = completedParagraphs(text);
        for (let i = sentParagraphs; i < done.length; i++) {
          void sendPara(done[i]!, i === 0);
          sentParagraphs = i + 1;
        }
      },
      async finish(finalMarkdown: string): Promise<number[]> {
        stopped = true;
        await inflight;
        const all = paragraphsOf(finalMarkdown);
        const rest = all.slice(sentParagraphs).join("\n\n").trim();
        if (!rest) return [];
        return self.sendMarkdown(chatId, rest, { threadId: opts.threadId, replyTo: sentParagraphs === 0 ? opts.replyTo : undefined });
      },
      async discard() {
        stopped = true;
        await inflight;
      },
    };
  }

  /**
   * Live status message: what the bot is doing right now. Lists the tool calls of this run (done ones
   * with their duration, the running one with a ticking elapsed time) plus a thinking/writing line, so
   * a long browser or exec step is never silent. Edited in place (≥1.5s apart), deleted at the end.
   * With `sendsFinal` ("progress" streaming mode) `finish(text)` also sends the final answer as a
   * fresh message; otherwise the draft/block stream or a plain send delivers the answer.
   */
  statusStream(chatId: string | number, opts: { threadId?: number; replyTo?: number } = {}, cfg: { sendsFinal: boolean } = { sendsFinal: false }) {
    const self = this;
    const startedAt = Date.now();
    let messageId: number | null = null;
    let lastSent = "";
    let pending = "";
    let timer: NodeJS.Timeout | null = null;
    let inflight: Promise<void> = Promise.resolve();
    let stopped = false;
    let phase: "thinking" | "writing" = "thinking";
    let writingText = "";
    const steps: { id: string; name: string; preview?: string; at: number; ms?: number; ok?: boolean }[] = [];
    const flush = async () => {
      timer = null;
      const text = pending;
      if (stopped || !text || text === lastSent) return;
      inflight = inflight.then(async () => {
        try {
          if (messageId == null) {
            const m = await self.api.sendMessage(chatId, text, { message_thread_id: opts.threadId && opts.threadId !== 1 ? opts.threadId : undefined, disable_notification: true, link_preview_options: { is_disabled: true } });
            messageId = m.message_id;
          } else await self.api.editMessageText(chatId, messageId, text, { link_preview_options: { is_disabled: true } });
          lastSent = text;
        } catch (err) {
          if (!(err instanceof GrammyError && /message is not modified/i.test(err.description))) messageId = messageId ?? null;
        }
      });
      await inflight;
    };
    const render = () => {
      if (stopped) return;
      const lines = steps.slice(-8).map((s) => {
        const label = `${prettyToolName(s.name)}${s.preview ? ` ${s.preview}` : ""}`;
        return s.ms == null ? `🔧 ${label} … ${fmtDuration(Date.now() - s.at)}` : `${s.ok === false ? "⚠️" : "✅"} ${label} (${fmtDuration(s.ms)})`;
      });
      if (steps.length > 8) lines.unshift(`… ${steps.length - 8} earlier step${steps.length - 8 === 1 ? "" : "s"}`);
      const running = steps.some((s) => s.ms == null);
      const total = fmtDuration(Date.now() - startedAt);
      if (!running) {
        if (phase === "writing") lines.push(cfg.sendsFinal && writingText ? `✍️ ${writingText}` : `✍️ Writing… (${total})`);
        else lines.push(`⏳ Thinking… (${total})`);
      } else if (phase === "writing" && cfg.sendsFinal && writingText) lines.push(`✍️ ${writingText}`);
      pending = lines.join("\n").slice(0, 1000);
      if (!timer) timer = setTimeout(() => void flush(), messageId == null ? 0 : 1500);
    };
    // Heartbeat: the elapsed time keeps moving even when nothing else changes, so a stuck-looking
    // step is visibly still alive (Telegram tolerates an edit every few seconds per message).
    const heartbeat = setInterval(render, 5000);
    heartbeat.unref();
    const stop = async () => {
      stopped = true;
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      await inflight;
      if (messageId != null) await self.api.deleteMessage(chatId, messageId).catch(() => {});
    };
    return {
      thinking() {
        phase = "thinking";
        render();
      },
      tool(ev: { id: string; name: string; status: "start" | "end"; preview?: string; ms?: number; ok?: boolean }) {
        if (ev.status === "start") steps.push({ id: ev.id, name: ev.name, preview: ev.preview, at: Date.now() });
        else {
          const s = steps.find((x) => x.id === ev.id && x.ms == null) ?? steps.find((x) => x.name === ev.name && x.ms == null);
          if (s) {
            s.ms = ev.ms ?? Date.now() - s.at;
            s.ok = ev.ok;
          }
        }
        phase = "thinking";
        render();
      },
      writing(text?: string) {
        phase = "writing";
        if (text != null) {
          const t = text.replace(/\s+/g, " ").trim();
          writingText = t ? `${t.slice(0, 120)}${t.length > 120 ? "…" : ""}` : "";
        }
        render();
      },
      async finish(finalMarkdown: string): Promise<number[]> {
        await stop();
        return cfg.sendsFinal ? self.sendMarkdown(chatId, finalMarkdown, opts) : [];
      },
      async discard() {
        await stop();
      },
    };
  }

  /**
   * Streaming draft (OpenClaw "partial" mode): first send after ≥30 chars, then at most one edit
   * per second with the latest text; final text edits in place (chunk 1) and sends the remainder.
   */
  draft(chatId: string | number, opts: { threadId?: number; replyTo?: number } = {}) {
    const self = this;
    let messageId: number | null = null;
    let lastSent = "";
    let pending = "";
    let timer: NodeJS.Timeout | null = null;
    let inflight: Promise<void> = Promise.resolve();
    let failures = 0;
    let stopped = false;

    const flush = async () => {
      timer = null;
      const text = pending;
      if (stopped || failures >= 3 || !text || text === lastSent) return;
      const html = splitTelegramHtml(markdownToTelegramHtml(text))[0]!;
      inflight = inflight.then(async () => {
        try {
          if (messageId == null) {
            const m = await self.withPlainFallback(html, (t, parse_mode) =>
              self.api.sendMessage(chatId, t, {
                parse_mode,
                message_thread_id: opts.threadId && opts.threadId !== 1 ? opts.threadId : undefined,
                reply_parameters: opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
                link_preview_options: { is_disabled: true },
              }),
            );
            messageId = m.message_id;
          } else {
            await self.withPlainFallback(html, (t, parse_mode) =>
              self.api.editMessageText(chatId, messageId!, t, { parse_mode, link_preview_options: { is_disabled: true } }),
            );
          }
          lastSent = text;
          failures = 0;
        } catch (err) {
          if (err instanceof GrammyError && /message is not modified/i.test(err.description)) return;
          failures++;
        }
      });
      await inflight;
    };

    return {
      update(text: string) {
        if (stopped) return;
        pending = text;
        if (messageId == null && text.length < 30) return;
        if (!timer) timer = setTimeout(() => void flush(), messageId == null ? 0 : 1000);
      },
      /** Replace the draft with the final answer; returns the message ids used. */
      async finish(finalMarkdown: string): Promise<number[]> {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inflight;
        const html = markdownToTelegramHtml(finalMarkdown);
        const chunks = splitTelegramHtml(html);
        const ids: number[] = [];
        if (messageId != null) {
          try {
            await self.withPlainFallback(chunks[0]!, (t, parse_mode) =>
              self.api.editMessageText(chatId, messageId!, t, { parse_mode, link_preview_options: { is_disabled: true } }),
            );
            ids.push(messageId);
          } catch (err) {
            if (err instanceof GrammyError && /message is not modified/i.test(err.description)) {
              ids.push(messageId);
            } else {
              await self.api.deleteMessage(chatId, messageId).catch(() => {});
              ids.push(...(await self.sendMarkdown(chatId, finalMarkdown, opts)));
              return ids;
            }
          }
          for (const c of chunks.slice(1)) {
            const m = await self.withPlainFallback(c, (t, parse_mode) =>
              self.api.sendMessage(chatId, t, { parse_mode, message_thread_id: opts.threadId && opts.threadId !== 1 ? opts.threadId : undefined, link_preview_options: { is_disabled: true } }),
            );
            ids.push(m.message_id);
          }
          return ids;
        }
        return self.sendMarkdown(chatId, finalMarkdown, opts);
      },
      async discard() {
        stopped = true;
        if (timer) clearTimeout(timer);
        await inflight;
        if (messageId != null) await self.api.deleteMessage(chatId, messageId).catch(() => {});
      },
    };
  }
}


/** Paragraphs of a Markdown text: split on blank lines that are not inside a ``` fence. */
export function paragraphsOf(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (cur.length) out.push(cur.join("\n").trim());
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) out.push(cur.join("\n").trim());
  return out.filter(Boolean);
}

/** Paragraphs that are definitely complete while text is still streaming (a blank line follows them, outside fences). */
export function completedParagraphs(text: string): string[] {
  const all = paragraphsOf(text);
  if (!all.length) return [];
  // The last paragraph is complete only if the text ends with a blank line outside a fence.
  const fences = (text.match(/^\s*```/gm) ?? []).length;
  const endsWithBlank = /\n\s*\n\s*$/.test(text) && fences % 2 === 0;
  return endsWithBlank ? all : all.slice(0, -1);
}
