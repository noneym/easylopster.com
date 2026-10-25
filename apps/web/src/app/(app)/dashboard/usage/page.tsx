import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";

export const metadata = { title: "Usage" };

export default async function UsagePage() {
  const user = await requireUser();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  since.setUTCHours(0, 0, 0, 0);
  const [rows, bots] = await Promise.all([
    db.usageDaily.findMany({ where: { userId: user.id, day: { gte: since } }, orderBy: { day: "desc" } }),
    db.bot.findMany({ where: { userId: user.id }, select: { id: true, name: true } }),
  ]);
  const name = (id: string | null) => bots.find((b) => b.id === id)?.name ?? "(deleted bot)";
  const byDay = new Map<string, { messages: number; tokensIn: number; tokensOut: number; toolCalls: number; perBot: Record<string, number> }>();
  for (const r of rows) {
    const k = r.day.toISOString().slice(0, 10);
    const d = byDay.get(k) ?? { messages: 0, tokensIn: 0, tokensOut: 0, toolCalls: 0, perBot: {} };
    d.messages += r.messages;
    d.tokensIn += r.tokensIn;
    d.tokensOut += r.tokensOut;
    d.toolCalls += r.toolCalls;
    d.perBot[name(r.botId)] = (d.perBot[name(r.botId)] ?? 0) + r.messages;
    byDay.set(k, d);
  }
  const days = [...byDay.entries()];
  const today = days[0]?.[0] === new Date().toISOString().slice(0, 10) ? days[0][1] : null;
  const total = days.reduce((a, [, d]) => ({ m: a.m + d.messages, i: a.i + d.tokensIn, o: a.o + d.tokensOut, t: a.t + d.toolCalls }), { m: 0, i: 0, o: 0, t: 0 });

  return (
    <>
      <PageHeader title="Usage" description="Messages, tokens and tool calls per day (UTC) across all your bots. Tokens are billed by your own providers." />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {[
          { label: "Today", value: `${today?.messages ?? 0} / ${limitsFor(user).messagesPerDay}`, sub: "messages (daily limit)" },
          { label: "30 days", value: total.m.toLocaleString(), sub: "messages" },
          { label: "Tokens", value: `${(total.i / 1000).toFixed(0)}k / ${(total.o / 1000).toFixed(0)}k`, sub: "in / out, 30 days" },
          { label: "Tool calls", value: total.t.toLocaleString(), sub: "30 days" },
        ].map((c) => (
          <div key={c.label} className="card p-5">
            <p className="text-sm text-fg-muted">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight font-mono tabular-nums">{c.value}</p>
            <p className="text-xs text-fg-faint">{c.sub}</p>
          </div>
        ))}
      </section>
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-fg-faint">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">Day</th>
              <th className="px-5 py-3 font-medium text-right">Messages</th>
              <th className="px-5 py-3 font-medium text-right">Tokens in</th>
              <th className="px-5 py-3 font-medium text-right">Tokens out</th>
              <th className="px-5 py-3 font-medium text-right">Tool calls</th>
              <th className="px-5 py-3 font-medium">By bot</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular-nums">
            {days.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-fg-muted font-sans">
                  No usage yet.
                </td>
              </tr>
            )}
            {days.map(([day, d]) => (
              <tr key={day}>
                <td className="px-5 py-2.5">{day}</td>
                <td className="px-5 py-2.5 text-right">{d.messages}</td>
                <td className="px-5 py-2.5 text-right">{d.tokensIn.toLocaleString()}</td>
                <td className="px-5 py-2.5 text-right">{d.tokensOut.toLocaleString()}</td>
                <td className="px-5 py-2.5 text-right">{d.toolCalls}</td>
                <td className="px-5 py-2.5 font-sans text-fg-muted">
                  {Object.entries(d.perBot)
                    .map(([b, n]) => `${b} ${n}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
