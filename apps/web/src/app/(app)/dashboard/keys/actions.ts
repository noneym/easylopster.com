"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encrypt, decrypt, maskSecret } from "@easylopster/shared/crypto";
import { PROVIDERS, isProviderId } from "@easylopster/shared/providers";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { testProviderKey } from "@/lib/provider-test";

export type KeyFormState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string; models?: string[] }
  | undefined;

const schema = z.object({
  provider: z.string().refine(isProviderId, "Pick a provider"),
  label: z.string().trim().min(1, "Give the key a label").max(60),
  apiKey: z.string().trim().min(1, "Paste the API key").max(4000),
  baseUrl: z.string().trim().url("Enter a full URL, e.g. https://api.example.com/v1").optional().or(z.literal("")),
  defaultModel: z.string().trim().max(200).optional().or(z.literal("")),
});

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] = i.message;
  return out;
}

/** Tests the key without saving. Used by the "Test" button on the create form. */
export async function testKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const { provider, apiKey, baseUrl } = parsed.data;
  const r = await testProviderKey(provider, apiKey, baseUrl || PROVIDERS[provider].defaultBaseUrl);
  return { ok: r.ok, message: r.message, models: r.models };
}

export async function createKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const { provider, label, apiKey, baseUrl } = parsed.data;
  const info = PROVIDERS[provider];
  if (info.needsBaseUrl && !baseUrl) return { fieldErrors: { baseUrl: "This provider needs a base URL" } };

  const effectiveBase = baseUrl || info.defaultBaseUrl || null;
  const test = await testProviderKey(provider, apiKey, effectiveBase);
  if (!test.ok) return { error: test.message };

  const defaultModel = parsed.data.defaultModel || info.defaultModel || test.models?.[0] || "";
  if (!defaultModel) return { fieldErrors: { defaultModel: "Enter the model id to use by default" } };

  const row = await db.providerKey.create({
    data: {
      userId: user.id,
      provider,
      label,
      encKey: encrypt(apiKey),
      keyLast4: maskSecret(apiKey).slice(-4),
      baseUrl: effectiveBase,
      defaultModel,
      lastTestedAt: new Date(),
      lastTestOk: true,
      lastTestMsg: test.message,
      modelsCache: test.models?.length ? test.models.slice(0, 500) : undefined,
      modelsMeta: test.modelsMeta && Object.keys(test.modelsMeta).length ? test.modelsMeta : undefined,
    },
  });
  revalidatePath("/dashboard/keys");
  redirect(`/dashboard/keys/${row.id}`);
}

/** Model list for a key that is being typed (not saved yet): the create form calls this as you type. */
export async function probeModels(provider: string, apiKey: string, baseUrl?: string): Promise<{ models?: string[]; contexts?: Record<string, number>; error?: string }> {
  await requireUser();
  if (!isProviderId(provider)) return { error: "Unknown provider" };
  const key = apiKey.trim();
  if (key.length < 8) return { error: "Paste the API key first" };
  const r = await testProviderKey(provider, key, baseUrl?.trim() || PROVIDERS[provider].defaultBaseUrl);
  if (!r.ok) return { error: r.message };
  return { models: r.models ?? [], contexts: contextsOf(r.modelsMeta) };
}

/** Re-asks the provider for a saved key's models, stores the list and returns it for the picker. */
export async function refreshKeyModels(id: string): Promise<{ models?: string[]; contexts?: Record<string, number>; error?: string }> {
  const user = await requireUser();
  const row = await db.providerKey.findFirst({ where: { id, userId: user.id } });
  if (!row) return { error: "Key not found" };
  const r = await testProviderKey(row.provider as never, decrypt(row.encKey), row.baseUrl);
  await db.providerKey.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: r.ok,
      lastTestMsg: r.message.slice(0, 500),
      ...(r.ok && r.models?.length ? { modelsCache: r.models.slice(0, 500) } : {}),
      ...(r.ok && r.modelsMeta && Object.keys(r.modelsMeta).length ? { modelsMeta: r.modelsMeta } : {}),
    },
  });
  revalidatePath(`/dashboard/keys/${id}`);
  if (!r.ok) return { error: r.message };
  return { models: r.models ?? [], contexts: contextsOf(r.modelsMeta) };
}

function contextsOf(meta?: Record<string, { context?: number }>): Record<string, number> | undefined {
  if (!meta) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(meta)) if (v?.context) out[k] = v.context;
  return Object.keys(out).length ? out : undefined;
}

export async function retestKey(id: string) {
  const user = await requireUser();
  const row = await db.providerKey.findFirst({ where: { id, userId: user.id } });
  if (!row) return;
  const r = await testProviderKey(row.provider as never, decrypt(row.encKey), row.baseUrl);
  await db.providerKey.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: r.ok,
      lastTestMsg: r.message.slice(0, 500),
      ...(r.ok && r.models?.length ? { modelsCache: r.models.slice(0, 500) } : {}),
      ...(r.ok && r.modelsMeta && Object.keys(r.modelsMeta).length ? { modelsMeta: r.modelsMeta } : {}),
    },
  });
  revalidatePath(`/dashboard/keys/${id}`);
}

export async function updateKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = z
    .object({ label: z.string().trim().min(1).max(60), defaultModel: z.string().trim().min(1, "Model id is required").max(200) })
    .safeParse({ label: formData.get("label"), defaultModel: formData.get("defaultModel") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const r = await db.providerKey.updateMany({ where: { id, userId: user.id }, data: parsed.data });
  if (r.count === 0) return { error: "Key not found" };
  revalidatePath(`/dashboard/keys/${id}`);
  revalidatePath("/dashboard/keys");
  return { ok: true, message: "Saved." };
}

export async function deleteKey(id: string) {
  const user = await requireUser();
  await db.providerKey.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/dashboard/keys");
  redirect("/dashboard/keys");
}
