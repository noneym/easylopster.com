import "server-only";
import nodemailer from "nodemailer";

export function mailEnabled() {
  return process.env.EMAIL_VERIFICATION === "on" && !!process.env.SMTP_HOST;
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function tx() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  await tx().sendMail({ from: process.env.SMTP_FROM ?? "easylopster <no-reply@easylopster.com>", to, subject, text, html });
}
