/** Liveness probe: answers without touching the database or Redis. */
export const dynamic = "force-dynamic";

export function GET() {
  const m = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1048576);
  return Response.json(
    { ok: true, uptime: Math.round(process.uptime()), rssMb: mb(m.rss), heapMb: mb(m.heapUsed) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
