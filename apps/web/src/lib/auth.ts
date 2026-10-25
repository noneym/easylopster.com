import "server-only";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import argon2 from "argon2";
import { db } from "./db";
import { randomToken } from "@easylopster/shared/crypto";

export const SESSION_COOKIE = "el_session";
/** While an admin views a member's account, the admin's own session id is parked here. */
export const ADMIN_SESSION_COOKIE = "el_admin_session";
const SESSION_DAYS = 30;

function cookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires };
}

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(password: string, hash: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Comma-separated ADMIN_EMAILS; accounts listed here become admins when they sign in. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Called on every successful sign-in: promotes ADMIN_EMAILS accounts to role=admin. Returns the (possibly updated) role. */
export async function promoteIfAdminEmail(user: { id: string; email: string; role: string }): Promise<string> {
  if (user.role === "admin" || !adminEmails().includes(user.email.toLowerCase())) return user.role;
  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  console.log(`[auth] promoted ${user.email} to admin (ADMIN_EMAILS)`);
  return "admin";
}

export async function createSession(userId: string) {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  await db.session.create({
    data: {
      id,
      userId,
      expiresAt,
      userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, cookieOptions(expiresAt));
  return id;
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await db.session.deleteMany({ where: { id } });
  jar.delete(SESSION_COOKIE);
  // Signing out while impersonating ends the member's session but keeps the admin signed in.
  const adminId = jar.get(ADMIN_SESSION_COOKIE)?.value;
  jar.delete(ADMIN_SESSION_COOKIE);
  if (adminId) {
    const admin = await db.session.findUnique({ where: { id: adminId }, include: { user: { select: { role: true } } } });
    if (admin && admin.expiresAt > new Date() && admin.user.role === "admin") jar.set(SESSION_COOKIE, adminId, cookieOptions(admin.expiresAt));
  }
}

export const getCurrentSession = cache(async () => {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await db.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
});

export const getCurrentUser = cache(async () => {
  const session = await getCurrentSession();
  return session?.user ?? null;
});

/** For server components/actions under /dashboard: returns the user or throws a redirect. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For /dashboard/admin pages and admin server actions: the signed-in user must have role=admin. */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

/**
 * The admin behind the current impersonation, if any: the parked admin session must still be valid and
 * belong to an admin. Null when nobody is impersonating (or the parked session is stale).
 */
export const getImpersonator = cache(async () => {
  const jar = await cookies();
  const adminId = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!adminId) return null;
  const session = await db.session.findUnique({ where: { id: adminId }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.role !== "admin") return null;
  return session.user;
});

/** Admin only: start a session as `targetUserId`, parking the admin's own session in ADMIN_SESSION_COOKIE. */
export async function impersonate(targetUserId: string) {
  const jar = await cookies();
  const current = await getCurrentSession();
  if (!current || current.user.role !== "admin") redirect("/dashboard");
  if (current.userId === targetUserId) return;
  const target = await db.user.findUnique({ where: { id: targetUserId }, select: { id: true, email: true } });
  if (!target) return;
  const h = await headers();
  console.log(`[admin] ${current.user.email} impersonates ${target.email} (${target.id}) from ${h.get("x-forwarded-for") ?? "local"}`);
  jar.set(ADMIN_SESSION_COOKIE, current.id, cookieOptions(current.expiresAt));
  await createSession(target.id);
}

/** Ends an impersonation: drops the member's session and restores the admin's. Returns false when nothing was parked. */
export async function stopImpersonation(): Promise<boolean> {
  const jar = await cookies();
  const adminId = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!adminId) return false;
  const memberId = jar.get(SESSION_COOKIE)?.value;
  const admin = await db.session.findUnique({ where: { id: adminId }, include: { user: { select: { email: true, role: true } } } });
  if (memberId && memberId !== adminId) {
    const member = await db.session.findUnique({ where: { id: memberId }, include: { user: { select: { email: true } } } });
    await db.session.deleteMany({ where: { id: memberId } });
    console.log(`[admin] ${admin?.user.email ?? "?"} stops impersonating ${member?.user.email ?? memberId}`);
  }
  jar.delete(ADMIN_SESSION_COOKIE);
  if (!admin || admin.expiresAt < new Date() || admin.user.role !== "admin") {
    jar.delete(SESSION_COOKIE);
    return false;
  }
  jar.set(SESSION_COOKIE, adminId, cookieOptions(admin.expiresAt));
  return true;
}
