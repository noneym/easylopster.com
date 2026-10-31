"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encrypt, maskSecret } from "@easylopster/shared/crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { STORAGE_PROVIDERS, credsOf, deleteObject, deletePrefix, listStorage, normalizePrefix, presignGet, putObject, testStorage, type StorageCreds, type StorageEntry } from "@/lib/storage";

export type StorageFormState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

const schema = z.object({
  provider: z.string().refine((p) => p in STORAGE_PROVIDERS, "Pick a provider"),
  endpoint: z.string().trim().url("Full URL, e.g. https://<id>.r2.cloudflarestorage.com").optional().or(z.literal("")),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  bucket: z.string().trim().min(3, "Bucket name").max(120),
  prefix: z.string().trim().max(200).optional().or(z.literal("")),
  forcePathStyle: z.string().optional(),
  accessKeyId: z.string().trim().max(400).optional().or(z.literal("")),
  secretAccessKey: z.string().trim().max(400).optional().or(z.literal("")),
});

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] = i.message;
  return out;
}

async function credsFromForm(userId: string, formData: FormData): Promise<{ creds?: StorageCreds; data?: z.infer<typeof schema>; error?: StorageFormState }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: { fieldErrors: fieldErrorsOf(parsed.error) } };
  const d = parsed.data;
  const info = STORAGE_PROVIDERS[d.provider as keyof typeof STORAGE_PROVIDERS];
  if (d.provider !== "s3" && !d.endpoint) return { error: { fieldErrors: { endpoint: `${info.label} needs an endpoint URL` } } };
  // Keys may be left empty when editing: keep the saved ones.
  let accessKeyId = d.accessKeyId ?? "";
  let secretAccessKey = d.secretAccessKey ?? "";
  if (!accessKeyId || !secretAccessKey) {
    const existing = await db.storageConfig.findUnique({ where: { userId } });
    if (!existing) {
      const fe: Record<string, string> = {};
      if (!accessKeyId) fe.accessKeyId = "Access key id";
      if (!secretAccessKey) fe.secretAccessKey = "Secret access key";
      return { error: { fieldErrors: fe } };
    }
    const saved = credsOf(existing);
    accessKeyId = accessKeyId || saved.accessKeyId;
    secretAccessKey = secretAccessKey || saved.secretAccessKey;
  }
  return {
    data: d,
    creds: { endpoint: d.endpoint || null, region: d.region || (d.provider === "r2" ? "auto" : "us-east-1"), bucket: d.bucket, prefix: normalizePrefix(d.prefix ?? ""), forcePathStyle: d.forcePathStyle === "on", accessKeyId, secretAccessKey },
  };
}

export async function testStorageAction(_prev: StorageFormState, formData: FormData): Promise<StorageFormState> {
  const user = await requireUser();
  const r = await credsFromForm(user.id, formData);
  if (r.error || !r.creds) return r.error;
  const t = await testStorage(r.creds);
  return { ok: t.ok, message: t.message, error: t.ok ? undefined : t.message };
}

export async function saveStorage(_prev: StorageFormState, formData: FormData): Promise<StorageFormState> {
  const user = await requireUser();
  const r = await credsFromForm(user.id, formData);
  if (r.error || !r.creds || !r.data) return r.error;
  const t = await testStorage(r.creds);
  if (!t.ok) return { error: t.message };
  const c = r.creds;
  const data = {
    provider: r.data.provider,
    endpoint: c.endpoint,
    region: c.region,
    bucket: c.bucket,
    prefix: c.prefix,
    forcePathStyle: c.forcePathStyle,
    encAccessKey: encrypt(c.accessKeyId),
    encSecretKey: encrypt(c.secretAccessKey),
    accessKeyLast4: maskSecret(c.accessKeyId).slice(-4),
    lastTestedAt: new Date(),
    lastTestOk: true,
    lastTestMsg: t.message.slice(0, 500),
  };
  await db.storageConfig.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  revalidatePath("/dashboard/storage");
  return { ok: true, message: "Storage connected." };
}

export async function removeStorage() {
  const user = await requireUser();
  await db.storageConfig.deleteMany({ where: { userId: user.id } });
  await db.backupPolicy.updateMany({ where: { bot: { userId: user.id } }, data: { enabled: false, lastStatus: "error", lastError: "storage disconnected" } });
  revalidatePath("/dashboard/storage");
}

async function userCreds(userId: string): Promise<StorageCreds> {
  const cfg = await db.storageConfig.findUnique({ where: { userId } });
  if (!cfg) throw new Error("No storage connected");
  return credsOf(cfg);
}

export async function browseStorage(path: string, token?: string): Promise<{ entries: StorageEntry[]; nextToken?: string; error?: string }> {
  const user = await requireUser();
  try {
    const r = await listStorage(await userCreds(user.id), path, { token });
    return r;
  } catch (err) {
    return { entries: [], error: (err as Error).message };
  }
}

export async function storageDownloadUrl(path: string): Promise<{ url?: string; error?: string }> {
  const user = await requireUser();
  try {
    return { url: await presignGet(await userCreds(user.id), path, { download: true, expiresIn: 600 }) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function storageDelete(path: string, isDir: boolean): Promise<{ ok?: boolean; count?: number; error?: string }> {
  const user = await requireUser();
  try {
    const c = await userCreds(user.id);
    if (isDir) return { ok: true, count: await deletePrefix(c, path) };
    await deleteObject(c, path);
    return { ok: true, count: 1 };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function storageMkdir(path: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  try {
    const clean = path.replace(/\/+$/, "");
    if (!clean) return { error: "Folder name" };
    await putObject(await userCreds(user.id), `${clean}/`, "", "application/x-directory");
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
