"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encrypt } from "@easylopster/shared/crypto";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export type SecretFormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean } | undefined;

export async function createSecret(_prev: SecretFormState, formData: FormData): Promise<SecretFormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      name: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Use an ENV_STYLE_NAME: capitals, digits, underscores"),
      value: z.string().min(1, "Value is required").max(20_000),
      description: z.string().trim().max(300).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { fieldErrors: fe };
  }
  const { name, value, description } = parsed.data;
  await db.secret.upsert({
    where: { userId_name: { userId: user.id, name } },
    create: { userId: user.id, name, encValue: encrypt(value), description: description || null },
    update: { encValue: encrypt(value), description: description || null },
  });
  revalidatePath("/dashboard/secrets");
  return { ok: true };
}

export async function deleteSecret(id: string) {
  const user = await requireUser();
  await db.secret.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/dashboard/secrets");
}

export async function setBotSecrets(botId: string, formData: FormData) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) return;
  const secrets = await db.secret.findMany({ where: { userId: user.id }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.botSecret.deleteMany({ where: { botId } });
    for (const s of secrets) if (formData.get(`secret:${s.id}`) === "on") await tx.botSecret.create({ data: { botId, secretId: s.id } });
  });
  revalidatePath(`/dashboard/agents/${botId}`);
}
