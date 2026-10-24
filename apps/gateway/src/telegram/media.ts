import { Api, InputFile } from "grammy";
import path from "node:path";
import { db } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";
import type { Workspace } from "../workspace/fs.ts";

/**
 * Inbound media: download Telegram files into the bot workspace (inbox/YYYY-MM-DD/<name>) and
 * describe them to the model; images are attached as vision parts, voice notes are transcribed
 * with OpenAI Whisper when the owner has an OpenAI key. Outbound: `MEDIA:<path>` directive lines.
 */

export const MEDIA_MAX_MB = 20;
export const MEDIA_TOKEN_RE = /^\s*MEDIA:\s*`?([^\n`]+)`?\s*$/gim;

export interface InboundMedia {
  /** text lines appended to the user message */
  notes: string[];
  /** image parts for vision-capable models */
  images: { data: Buffer; mimeType: string }[];
}

interface TgFileRef {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

function dayDir(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function download(api: Api, token: string, ref: TgFileRef): Promise<{ buf: Buffer; name: string } | null> {
  if (ref.file_size && ref.file_size > MEDIA_MAX_MB * 1024 * 1024) return null;
  const f = await api.getFile(ref.file_id);
  if (!f.file_path) return null;
  const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const name = ref.file_name ?? path.basename(f.file_path);
  return { buf, name };
}

async function transcribe(userId: string, buf: Buffer, name: string): Promise<string | null> {
  const key = await db.providerKey.findFirst({ where: { userId, provider: "openai" } });
  if (!key) return null;
  const form = new FormData();
  form.append("file", new Blob([buf]), name);
  form.append("model", "whisper-1");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${decrypt(key.encKey)}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { text?: string };
  return j.text ?? null;
}

export async function collectInboundMedia(
  api: Api,
  token: string,
  ws: Workspace,
  userId: string,
  timezone: string,
  m: { photo?: { file_id: string; file_size?: number; width: number; height: number }[]; document?: TgFileRef; voice?: TgFileRef & { duration?: number }; audio?: TgFileRef; video?: TgFileRef; video_note?: TgFileRef; sticker?: { emoji?: string } },
): Promise<InboundMedia> {
  const out: InboundMedia = { notes: [], images: [] };
  const dir = `inbox/${dayDir(timezone)}`;
  const save = async (buf: Buffer, name: string) => {
    const safe = name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const rel = `${dir}/${Date.now().toString(36)}-${safe}`;
    await ws.write(rel, buf.toString("binary"));
    // write() is text-only; rewrite as bytes for binary payloads
    const { writeFile } = await import("node:fs/promises");
    await writeFile(ws.resolve(rel), buf);
    return rel;
  };

  try {
    if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1]!;
      const d = await download(api, token, { file_id: best.file_id, file_size: best.file_size, file_name: `photo-${best.width}x${best.height}.jpg` });
      if (d) {
        const rel = await save(d.buf, d.name);
        out.images.push({ data: d.buf, mimeType: "image/jpeg" });
        out.notes.push(`[media:image saved at ${rel}]`);
      } else out.notes.push("[media:image unavailable (too large or download failed)]");
    }
    if (m.voice || m.audio || m.video_note) {
      const ref = (m.voice ?? m.audio ?? m.video_note)!;
      const d = await download(api, token, { ...ref, file_name: ref.file_name ?? (m.voice ? "voice.oga" : m.audio ? "audio.mp3" : "video-note.mp4") });
      if (d) {
        const rel = await save(d.buf, d.name);
        const text = m.video_note ? null : await transcribe(userId, d.buf, d.name).catch(() => null);
        out.notes.push(text ? `[voice note transcript] ${text}` : `[media:audio saved at ${rel}; transcription unavailable (add an OpenAI key to enable Whisper)]`);
      } else out.notes.push("[media:audio unavailable]");
    }
    if (m.document) {
      const d = await download(api, token, m.document);
      if (d) {
        const rel = await save(d.buf, d.name);
        const isText = /^(text\/|application\/(json|xml|x-yaml|javascript))/.test(m.document.mime_type ?? "") || /\.(md|txt|csv|json|ya?ml|log|py|ts|js|html?)$/i.test(d.name);
        if (m.document.mime_type?.startsWith("image/")) out.images.push({ data: d.buf, mimeType: m.document.mime_type });
        out.notes.push(`[media:document ${d.name} saved at ${rel}${isText && d.buf.length < 60_000 ? `]\n${d.buf.toString("utf8").slice(0, 20_000)}` : "]"}`);
      } else out.notes.push(`[media:document ${m.document.file_name ?? ""} unavailable (max ${MEDIA_MAX_MB} MB)]`);
    }
    if (m.video) {
      const d = await download(api, token, { ...m.video, file_name: m.video.file_name ?? "video.mp4" });
      out.notes.push(d ? `[media:video saved at ${await save(d.buf, d.name)}]` : "[media:video unavailable]");
    }
    if (m.sticker) out.notes.push(`[sticker ${m.sticker.emoji ?? ""}]`.trim());
  } catch (err) {
    out.notes.push(`[media download failed: ${err instanceof Error ? err.message : String(err)}]`);
  }
  return out;
}

/** Splits `MEDIA:` directive lines out of a reply (OpenClaw parse-output). */
export function extractMedia(text: string): { text: string; media: string[] } {
  const media: string[] = [];
  const cleaned = text
    .split("\n")
    .filter((line) => {
      const m = line.match(/^\s*MEDIA:\s*`?([^\n`]+?)`?\s*$/i);
      if (m) {
        media.push(m[1]!.trim());
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
  return { text: cleaned, media };
}

/** Sends workspace files or https URLs referenced by MEDIA: lines. */
export async function sendMedia(api: Api, chatId: string | number, ws: Workspace, items: string[], threadId?: number): Promise<string[]> {
  const sent: string[] = [];
  for (const item of items.slice(0, 5)) {
    try {
      const opts = { message_thread_id: threadId && threadId !== 1 ? threadId : undefined };
      if (/^https?:\/\//i.test(item)) {
        if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(item)) await api.sendPhoto(chatId, item, opts);
        else await api.sendDocument(chatId, item, opts);
        sent.push(item);
        continue;
      }
      const abs = ws.resolve(item.replace(/^\/workspace\//, ""));
      const file = new InputFile(abs);
      if (/\.(png|jpe?g|gif|webp)$/i.test(abs)) await api.sendPhoto(chatId, file, opts);
      else if (/\.(mp3|m4a|ogg|oga|wav)$/i.test(abs)) await api.sendAudio(chatId, file, opts);
      else await api.sendDocument(chatId, file, opts);
      sent.push(item);
    } catch (err) {
      await api.sendMessage(chatId, `Could not send ${item}: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    }
  }
  return sent;
}
