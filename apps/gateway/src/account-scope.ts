/**
 * Development safety net. The database is shared with production, so a developer's gateway must
 * never act for other people's bots: polling would steal Telegram webhooks, the automation
 * scheduler would run their crons on the developer's machine (wrong workspace, no nodes) and
 * message them, dreaming would rewrite their memory. GATEWAY_ACCOUNT_EMAILS (comma separated;
 * TELEGRAM_POLLING_EMAILS is accepted as an alias) limits every background job to those accounts.
 * Unset in production.
 */
const emails = (process.env.GATEWAY_ACCOUNT_EMAILS ?? process.env.TELEGRAM_POLLING_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const ACCOUNT_SCOPE_EMAILS: readonly string[] = emails;

/** Prisma `where` fragment for a Bot relation: `{ bot: { ...botScope() } }` or spread into a Bot where. */
export function botScope(): { user?: { email: { in: string[] } } } {
  return emails.length ? { user: { email: { in: emails } } } : {};
}

export function accountScopeSummary(): string {
  return emails.length ? `account scope: ${emails.join(", ")}` : "account scope: all (production)";
}
