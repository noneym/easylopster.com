import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { decrypt } from "@easylopster/shared/crypto";
import type { StorageConfig } from "@easylopster/db/client";

/**
 * Bring-your-own S3 storage for an account: AWS S3, Cloudflare R2, MinIO, Backblaze B2 or any
 * S3-compatible endpoint. The dashboard's file browser, the agent tools (gateway side, same
 * shape) and backups all go through the account's own bucket; nothing is stored on our disks.
 */
export const STORAGE_PROVIDERS = {
  s3: { label: "Amazon S3", endpointHint: "leave empty", regionHint: "e.g. eu-central-1", pathStyle: false, docs: "https://console.aws.amazon.com/s3/" },
  r2: { label: "Cloudflare R2", endpointHint: "https://<accountid>.r2.cloudflarestorage.com", regionHint: "auto", pathStyle: false, docs: "https://dash.cloudflare.com/?to=/:account/r2" },
  minio: { label: "MinIO / self-hosted", endpointHint: "https://minio.example.com", regionHint: "us-east-1", pathStyle: true, docs: "https://min.io/docs/minio/linux/administration/identity-access-management.html" },
  b2: { label: "Backblaze B2", endpointHint: "https://s3.<region>.backblazeb2.com", regionHint: "e.g. eu-central-003", pathStyle: false, docs: "https://secure.backblaze.com/app_keys.htm" },
  other: { label: "Other S3-compatible", endpointHint: "https://s3.example.com", regionHint: "us-east-1", pathStyle: true, docs: "" },
} as const;
export type StorageProvider = keyof typeof STORAGE_PROVIDERS;

export type StorageCreds = { endpoint?: string | null; region: string; bucket: string; prefix: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };

export function credsOf(cfg: StorageConfig): StorageCreds {
  return { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, prefix: cfg.prefix, forcePathStyle: cfg.forcePathStyle, accessKeyId: decrypt(cfg.encAccessKey), secretAccessKey: decrypt(cfg.encSecretKey) };
}

export function s3Client(c: StorageCreds): S3Client {
  return new S3Client({
    region: c.region || "auto",
    endpoint: c.endpoint || undefined,
    forcePathStyle: c.forcePathStyle,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
}

/** Normalizes a user-typed prefix to "" or "a/b/". */
export function normalizePrefix(p: string): string {
  const clean = p.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return clean ? `${clean}/` : "";
}

/** Joins the account prefix with a browser path ("docs/x.txt" → "<prefix>docs/x.txt"), rejecting escapes. */
export function keyFor(c: StorageCreds, rel: string): string {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.split("/").some((s) => s === "..")) throw new Error("invalid path");
  return c.prefix + clean;
}

export async function testStorage(c: StorageCreds): Promise<{ ok: boolean; message: string }> {
  const client = s3Client(c);
  try {
    await client.send(new HeadBucketCommand({ Bucket: c.bucket }));
  } catch (err) {
    const e = err as Error & { $metadata?: { httpStatusCode?: number }; name?: string };
    // Some providers refuse HeadBucket for scoped keys; a list is the better probe then.
    try {
      await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, MaxKeys: 1 }));
    } catch (err2) {
      const e2 = err2 as Error & { $metadata?: { httpStatusCode?: number } };
      return { ok: false, message: `${e2.name ?? e.name ?? "Error"}: ${e2.message || e.message}`.slice(0, 400) };
    }
  }
  const probe = `${c.prefix}.easylopster-write-test`;
  try {
    await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: probe, Body: "ok", ContentType: "text/plain" }));
    await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: probe }));
  } catch (err) {
    return { ok: false, message: `Bucket is readable but not writable: ${(err as Error).message}`.slice(0, 400) };
  }
  return { ok: true, message: `Connected to ${c.bucket}${c.prefix ? `/${c.prefix}` : ""}; read and write work.` };
}

export interface StorageEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedAt?: string;
}

/** One "folder" level of the bucket under the account prefix. */
export async function listStorage(c: StorageCreds, rel = "", opts: { limit?: number; token?: string } = {}): Promise<{ entries: StorageEntry[]; nextToken?: string }> {
  const client = s3Client(c);
  const base = rel ? `${keyFor(c, rel).replace(/\/+$/, "")}/` : c.prefix;
  const r = await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: base, Delimiter: "/", MaxKeys: Math.min(opts.limit ?? 500, 1000), ContinuationToken: opts.token }));
  const entries: StorageEntry[] = [];
  for (const p of r.CommonPrefixes ?? []) {
    const k = p.Prefix ?? "";
    const path = k.slice(c.prefix.length).replace(/\/$/, "");
    entries.push({ name: path.split("/").pop() ?? path, path, type: "dir" });
  }
  for (const o of r.Contents ?? []) {
    const k = o.Key ?? "";
    if (k === base) continue; // the folder marker itself
    const path = k.slice(c.prefix.length);
    if (path.endsWith("/")) continue;
    entries.push({ name: path.split("/").pop() ?? path, path, type: "file", size: o.Size ?? 0, modifiedAt: o.LastModified?.toISOString() });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { entries, nextToken: r.IsTruncated ? r.NextContinuationToken : undefined };
}

export async function presignGet(c: StorageCreds, rel: string, opts: { expiresIn?: number; download?: boolean } = {}): Promise<string> {
  const client = s3Client(c);
  const key = keyFor(c, rel);
  const cmd = new GetObjectCommand({ Bucket: c.bucket, Key: key, ResponseContentDisposition: opts.download ? `attachment; filename="${encodeURIComponent(rel.split("/").pop() ?? "file")}"` : undefined });
  return getSignedUrl(client, cmd, { expiresIn: opts.expiresIn ?? 3600 });
}

export async function putObject(c: StorageCreds, rel: string, body: Buffer | Uint8Array | string, contentType?: string) {
  const client = s3Client(c);
  await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel), Body: body, ContentType: contentType }));
}

export async function deleteObject(c: StorageCreds, rel: string) {
  const client = s3Client(c);
  await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: keyFor(c, rel) }));
}

/** Deletes a "folder": every object under the prefix (in pages of 1000). */
export async function deletePrefix(c: StorageCreds, rel: string): Promise<number> {
  const client = s3Client(c);
  const base = `${keyFor(c, rel).replace(/\/+$/, "")}/`;
  let token: string | undefined;
  let n = 0;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: base, MaxKeys: 1000, ContinuationToken: token }));
    const keys = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: keys, Quiet: true } }));
      n += keys.length;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return n;
}

/** Rough usage under the account prefix (walks the listing; fine for personal buckets). */
export async function storageUsage(c: StorageCreds, maxObjects = 20_000): Promise<{ objects: number; bytes: number; partial: boolean }> {
  const client = s3Client(c);
  let token: string | undefined;
  let objects = 0;
  let bytes = 0;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, MaxKeys: 1000, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      objects++;
      bytes += o.Size ?? 0;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
    if (objects >= maxObjects) return { objects, bytes, partial: true };
  } while (token);
  return { objects, bytes, partial: false };
}
