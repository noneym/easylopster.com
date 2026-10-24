import "server-only";
import nodemailer from "nodemailer";

/**
 * Outgoing mail. Transport is picked from the environment:
 *   MAIL_MAILER=cloudflare  -> Cloudflare Email Service REST API (POST /accounts/{id}/email/sending/send)
 *   MAIL_MAILER=smtp        -> nodemailer SMTP
 *   unset                   -> cloudflare when CLOUDFLARE_EMAIL_* is set, else smtp when SMTP_HOST is set, else off
 */
type Transport = "cloudflare" | "smtp" | "off";

function transportKind(): Transport {
  const forced = (process.env.MAIL_MAILER ?? "").toLowerCase();
  const cf = !!(process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID && process.env.CLOUDFLARE_EMAIL_API_TOKEN);
  const smtp = !!process.env.SMTP_HOST;
  if (forced === "cloudflare") return cf ? "cloudflare" : "off";
  if (forced === "smtp") return smtp ? "smtp" : "off";
  return cf ? "cloudflare" : smtp ? "smtp" : "off";
}

export function mailEnabled() {
  return process.env.EMAIL_VERIFICATION === "on" && transportKind() !== "off";
}

export function mailTransportName(): Transport {
  return transportKind();
}

/** "Name <addr>" or plain address from MAIL_FROM (SMTP_FROM accepted for compatibility). */
function sender(): { name: string; email: string; header: string } {
  const raw = (process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? "easylopster <no-reply@easylopster.com>").trim();
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return m ? { name: m[1]!.trim().replace(/^"|"$/g, ""), email: m[2]!.trim(), header: raw } : { name: "", email: raw, header: raw };
}

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function smtp() {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return smtpTransport;
}

async function sendViaCloudflare(to: string, subject: string, text: string, html?: string) {
  const base = (process.env.CLOUDFLARE_EMAIL_BASE_URL ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  const accountId = process.env.CLOUDFLARE_EMAIL_ACCOUNT_ID!;
  // Documented shape: `from` is a plain address, `to` an array of addresses.
  const res = await fetch(`${base}/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_EMAIL_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ from: sender().email, to: [to], subject: subject.slice(0, 200), text, html }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  let j: { success?: boolean; errors?: { code?: number; message: string }[]; result?: { permanent_bounces?: unknown[]; queued?: unknown[] } } = {};
  try {
    j = JSON.parse(raw);
  } catch {}
  if (!res.ok || j.success === false) {
    const all = (j.errors ?? []).map((e) => `${e.code ? `${e.code}: ` : ""}${e.message}`).join("; ") || `HTTP ${res.status} ${raw.slice(0, 300)}`;
    throw new Error(res.status === 401 || res.status === 403 ? `email service refused the token (${all})` : `email not sent (HTTP ${res.status}): ${all}`);
  }
  if (j.result?.permanent_bounces?.length) throw new Error(`${to} bounced: the address does not accept mail`);
  return j.result;
}

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const kind = transportKind();
  if (kind === "cloudflare") return sendViaCloudflare(to, subject, text, html);
  if (kind === "smtp") return smtp().sendMail({ from: sender().header, to, subject, text, html });
  throw new Error("mail transport is not configured");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain, readable transactional email: title, paragraphs, optional button, footer. */
export function renderMail(o: { title: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }): { html: string; text: string } {
  const p = o.paragraphs.map((x) => `<p style="margin:0 0 14px;line-height:1.55;color:#1f2937;font-size:15px">${esc(x).replace(/\n/g, "<br>")}</p>`).join("");
  const btn = o.button
    ? `<p style="margin:22px 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:#d9573f;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px;font-size:15px">${esc(o.button.label)}</a></p><p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.5">Or open this link: <a href="${esc(o.button.url)}" style="color:#b8452f;word-break:break-all">${esc(o.button.url)}</a></p>`
    : "";
  const foot = o.footer ? `<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5">${esc(o.footer)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f4f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 28px 22px"><div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:18px"><span style="display:inline-block;width:10px;height:10px;background:#d9573f;border-radius:3px;margin-right:8px"></span>easylopster</div><h1 style="margin:0 0 16px;font-size:20px;color:#111827">${esc(o.title)}</h1>${p}${btn}${foot}</div></body></html>`;
  const text = [o.title, "", ...o.paragraphs.flatMap((x) => [x, ""]), ...(o.button ? [`${o.button.label}: ${o.button.url}`, ""] : []), ...(o.footer ? ["--", o.footer] : [])].join("\n");
  return { html, text };
}
