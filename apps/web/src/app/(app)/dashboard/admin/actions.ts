"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { impersonate, requireAdmin, stopImpersonation } from "@/lib/auth";

export type AdminFormState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string> } | undefined;

/** Empty string -> null (use the global default); otherwise a non-negative integer. */
const override = z
  .union([z.literal(""), z.coerce.number().int("Whole number").min(0, "0 or more").max(1_000_000)])
  .transform((v) => (v === "" ? null : v));

const schema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "admin"]),
  limitBots: override,
  limitNodes: override,
  limitMcp: override,
  limitMessagesPerDay: override,
});

export async function updateUserAdmin(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { fieldErrors };
  }
  const { id, role, ...limits } = parsed.data;
  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  if (!target) return { error: "User not found" };
  if (target.id === admin.id && role !== "admin") return { error: "You cannot remove your own admin role." };
  await db.user.update({ where: { id }, data: { role, ...limits } });
  console.log(`[admin] ${admin.email} updated ${target.email}: role=${role} limits=${JSON.stringify(limits)}`);
  revalidatePath("/dashboard/admin");
  revalidatePath(`/dashboard/admin/${id}`);
  return { ok: true };
}

/** "Log in as" a member: the admin's own session is parked in a cookie and restored by `returnToAdmin`. */
export async function impersonateUser(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/dashboard/admin");
  await impersonate(id);
  redirect("/dashboard");
}

/** Ends the impersonation and sends the admin back to the member's admin page. */
export async function returnToAdmin(formData: FormData): Promise<void> {
  const back = String(formData.get("back") ?? "");
  const restored = await stopImpersonation();
  if (!restored) redirect("/login");
  redirect(back.startsWith("/dashboard/admin") ? back : "/dashboard/admin");
}
