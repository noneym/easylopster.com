import "server-only";
import { randomToken, sha256 } from "@easylopster/shared/crypto";
import { db } from "./db";
import { mailEnabled, renderMail, sendMail } from "./mailer";

const TTL_MS = 24 * 60 * 60_000;

/** Sends a verification email when SMTP is configured; silently no-ops otherwise. */
export async function sendVerificationEmail(userId: string, email: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  const token = randomToken(32);
  await db.emailToken.create({ data: { userId, kind: "verify", tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
  const url = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/verify?token=${token}`;
  const { html, text } = renderMail({
    title: "Confirm your email",
    paragraphs: ["Thanks for signing up to easylopster. Confirm this address to finish setting up your account.", "The link is valid for 24 hours."],
    button: { label: "Verify email", url },
    footer: "If you did not create an account, you can ignore this message.",
  });
  await sendMail(email, "Verify your easylopster email", text, html);
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
