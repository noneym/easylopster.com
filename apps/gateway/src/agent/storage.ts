import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";
import type { Workspace } from "../workspace/fs.ts";

/**
 * The account's own S3 bucket (configured on the Storage page) as a shared drive for all the
 * owner's agents, plus the destination of backups. Same client shape as the web app's lib/storage.
 */
export interface StorageCreds {
  endpoint?: string | null;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export async function storageFor(userId: string): Promise<StorageCreds | null> {
  const cfg = await db.storageConfig.findUnique({ where: { userId } });
  if (!cfg) return null;
  return { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, prefix: cfg.prefix, forcePathStyle: cfg.forcePathStyle, accessKeyId: decrypt(cfg.encAccessKey), secretAccessKey: decrypt(cfg.encSecretKey) };
}

export function s3Client(c: StorageCreds): S3Client {
  return new S3Client({ region: c.region || "auto", endpoint: c.endpoint || undefined, forcePathStyle: c.forcePathStyle, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
}

export function keyFor(c: StorageCreds, rel: string): string {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((s) => s === "..")) throw new Error("invalid storage path");
  return c.prefix + clean;
}

export async function storagePut(c: StorageCreds, rel: string, body: Buffer | string, contentType?: string) {
  await s3Client(c).send(new PutObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel), Body: body, ContentType: contentType }));
}
export async function storageGet(c: StorageCreds, rel: string): Promise<Buffer> {
  const r = await s3Client(c).send(new GetObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel) }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
export async function storageDelete(c: StorageCreds, rel: string) {
  await s3Client(c).send(new DeleteObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel) }));
}
export async function storageList(c: StorageCreds, rel: string, limit = 200): Promise<{ dirs: string[]; files: { path: string; size: number; modifiedAt?: string }[]; truncated: boolean }> {
  const base = rel.replace(/^\/+|\/+$/g, "") ? `${keyFor(c, rel).replace(/\/+$/, "")}/` : c.prefix;
  const r = await s3Client(c).send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: base, Delimiter: "/", MaxKeys: Math.min(limit, 1000) }));
  const dirs = (r.CommonPrefixes ?? []).map((p) => (p.Prefix ?? "").slice(c.prefix.length).replace(/\/$/, ""));
  const files = (r.Contents ?? [])
    .filter((o) => o.Key && o.Key !== base && !o.Key.endsWith("/"))
    .map((o) => ({ path: o.Key!.slice(c.prefix.length), size: o.Size ?? 0, modifiedAt: o.LastModified?.toISOString() }));
  return { dirs, files, truncated: !!r.IsTruncated };
}
export async function storageLink(c: StorageCreds, rel: string, expiresIn = 24 * 3600): Promise<string> {
  return getSignedUrl(s3Client(c), new GetObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel) }), { expiresIn });
}
export async function storageHealthy(c: StorageCreds): Promise<boolean> {
  try {
    await s3Client(c).send(new HeadBucketCommand({ Bucket: c.bucket }));
    return true;
  } catch {
    try {
      await s3Client(c).send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, MaxKeys: 1 }));
      return true;
    } catch {
      return false;
    }
  }
}

const TEXT_LIMIT = 60_000;
const BINARY_LIMIT = 50 * 1024 * 1024;

/** Tools over the owner's storage; returned empty when no storage is connected (the prompt says so). */
export function storageTools(creds: StorageCreds | null, ws: Workspace): ToolSet {
  if (!creds) return {};
  const c = creds;
  const safe = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
  return {
    storage_list: tool({
      description: "List one folder of the owner's shared storage (their own S3 bucket, shared by all their agents). Paths are relative; '' is the root. Shows sub-folders and files with sizes.",
      inputSchema: z.object({ path: z.string().max(500).default("") }),
      execute: ({ path }) => safe(() => storageList(c, path)),
    }),
    storage_read: tool({
      description: `Read a text file from the shared storage (up to ${TEXT_LIMIT} characters). For binary files use storage_copy to bring them into the workspace or storage_link to share them.`,
      inputSchema: z.object({ path: z.string().min(1).max(500) }),
      execute: ({ path }) =>
        safe(async () => {
          const buf = await storageGet(c, path);
          if (buf.includes(0)) return { path, binary: true, bytes: buf.length, hint: "binary file; use storage_copy or storage_link" };
          const text = buf.toString("utf8");
          return { path, bytes: buf.length, content: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…[truncated]` : text };
        }),
    }),
    storage_write: tool({
      description: "Create or overwrite a text file in the shared storage. Other agents of the owner can read it; use it for hand-offs, reports and files that should outlive this workspace.",
      inputSchema: z.object({ path: z.string().min(1).max(500), content: z.string().max(2_000_000), contentType: z.string().max(100).optional() }),
      execute: ({ path, content, contentType }) =>
        safe(async () => {
          await storagePut(c, path, content, contentType ?? (path.endsWith(".json") ? "application/json" : path.endsWith(".md") ? "text/markdown" : "text/plain; charset=utf-8"));
          return { ok: true, path, bytes: Buffer.byteLength(content) };
        }),
    }),
    storage_delete: tool({
      description: "Delete one file from the shared storage.",
      inputSchema: z.object({ path: z.string().min(1).max(500) }),
      execute: ({ path }) =>
        safe(async () => {
          await storageDelete(c, path);
          return { ok: true, path };
        }),
    }),
    storage_copy: tool({
      description: `Copy a file between this workspace and the shared storage. direction "to_storage": workspace file → storage (e.g. an export or an inbox attachment). direction "to_workspace": storage object → workspace (then read it with fs_read or attach it with MEDIA:). Binary files are fine (up to ${BINARY_LIMIT / 1024 / 1024} MB).`,
      inputSchema: z.object({ direction: z.enum(["to_storage", "to_workspace"]), workspacePath: z.string().min(1).max(500), storagePath: z.string().min(1).max(500) }),
      execute: ({ direction, workspacePath, storagePath }) =>
        safe(async () => {
          if (direction === "to_storage") {
            const abs = ws.resolve(workspacePath);
            const buf = await readFile(abs);
            if (buf.length > BINARY_LIMIT) throw new Error(`file larger than ${BINARY_LIMIT / 1024 / 1024} MB`);
            await storagePut(c, storagePath, buf);
            return { ok: true, storagePath, bytes: buf.length };
          }
          const buf = await storageGet(c, storagePath);
          if (buf.length > BINARY_LIMIT) throw new Error(`object larger than ${BINARY_LIMIT / 1024 / 1024} MB`);
          const abs = ws.resolve(workspacePath);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, buf);
          return { ok: true, workspacePath, bytes: buf.length };
        }),
    }),
    storage_link: tool({
      description: "A download link for a file in the shared storage, valid 24 hours. Use it to hand big files to the owner (it works in Telegram and the web chat).",
      inputSchema: z.object({ path: z.string().min(1).max(500) }),
      execute: ({ path }) => safe(async () => ({ path, url: await storageLink(c, path), expiresInHours: 24 })),
    }),
  };
}
