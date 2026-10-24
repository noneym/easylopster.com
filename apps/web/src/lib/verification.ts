import "server-only";
import { randomToken, sha256 } from "@easylopster/shared/crypto";
import { db } from "./db";
import { mailEnabled, sendMail } from "./mailer";

const TTL_MS = 24 * 60 * 60_000;

/** Sends a verification email when SMTP is configured; silently no-ops otherwise. */
export async function sendVerificationEmail(userId: string, email: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  const token = randomToken(32);
  await db.emailToken.create({ data: { userId, kind: "verify", tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/verify?token=${token}`;
  await sendMail(
    email,
    "Verify your easylopster email",
    `Confirm your email by opening this link (valid 24 hours):\n\n${url}\n\nIf you did not sign up, ignore this message.`,
    `<p>Confirm your email by opening this link (valid 24 hours):</p><p><a href="${url}">${url}</a></p><p>If you did not sign up, ignore this message.</p>`,
  );
  return true;
}

export async function consumeVerificationToken(token: string): Promise<boolean> {
  const row = await db.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.kind !== "verify" || row.usedAt || row.expiresAt < new Date()) return false;
  await db.$transaction([
    db.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  return true;
}
