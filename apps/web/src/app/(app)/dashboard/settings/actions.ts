"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";

export type FormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> } | undefined;

function fieldErrorsOf(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] = i.message;
  return out;
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name is required").max(80),
      timezone: z.string().trim().min(1).max(64),
    })
    .safeParse({ name: formData.get("name"), timezone: formData.get("timezone") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone });
  } catch {
    return { fieldErrors: { timezone: "Unknown time zone. Use an IANA name like Europe/Istanbul." } };
  }

  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({
      current: z.string().min(1, "Enter your current password"),
      next: z.string().min(8, "Use at least 8 characters").max(200),
    })
    .safeParse({ current: formData.get("current"), next: formData.get("next") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const ok = await verifyPassword(parsed.data.current, user.passwordHash);
  if (!ok) return { fieldErrors: { current: "Current password is incorrect" } };

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  return { ok: true };
}
