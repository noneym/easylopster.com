import "server-only";
import { mailTransportName, renderMail, sendMail } from "./mailer";

/**
 * Tells the operator (ADMIN_NOTIFY_EMAIL) about a new account. Never throws: a mail failure is logged and
 * registration goes on. When no transport is configured the notification is written to the server log.
 */
export async function notifyAdminNewUser(u: { id: string; email: string; name: string | null; provider: "password" | "google" }): Promise<void> {
  const to = process.env.ADMIN_NOTIFY_EMAIL?.trim();
  if (!to) return;
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const when = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const subject = `New easylopster user: ${u.email}`;
  const { html, text } = renderMail({
    title: "A new user signed up",
    paragraphs: [`Email: ${u.email}`, `Name: ${u.name ?? "-"}`, `Sign-in: ${u.provider === "google" ? "Google" : "email + password"}`, `Time: ${when}`],
    button: { label: "Open in admin", url: `${base}/dashboard/admin/${u.id}` },
    footer: "Sent to ADMIN_NOTIFY_EMAIL on every registration.",
  });
  if (mailTransportName() === "off") {
    console.log(`[admin-notify] mail transport off; would send to ${to}: ${subject}\n${text}`);
    return;
  }
  try {
    await sendMail(to, subject, text, html);
    console.log(`[admin-notify] sent "${subject}" to ${to}`);
  } catch (e) {
    console.error(`[admin-notify] failed to send "${subject}" to ${to}:`, e instanceof Error ? e.message : e);
  }
}
