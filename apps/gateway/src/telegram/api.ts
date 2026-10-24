import { Api, GrammyError } from "grammy";
import { htmlToPlainText, markdownToTelegramHtml, splitTelegramHtml } from "./format.ts";

/**
 * Outbound Telegram helpers over grammY's Api (no polling). HTML parse mode with a plain-text
 * fallback, 4000-char chunking, typing keepalive, and a throttled draft editor for streaming.
 */
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
