import { Redis } from "ioredis";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** SSE bridge: subscribes to the gateway's Redis channel for this conversation and relays events. */
export async function GET(_req: Request, ctx: RouteContext<"/api/chat/[conversationId]/stream">) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { conversationId } = await ctx.params;
  const conv = await db.conversation.findFirst({ where: { id: conversationId, bot: { userId: user.id } }, select: { id: true } });
  if (!conv) return new Response("not found", { status: 404 });

  const sub = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const channel = `chat:${conv.id}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      sub.on("message", (_ch, msg) => send(msg));
      await sub.subscribe(channel);
      send(JSON.stringify({ type: "ready" }));
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      _req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
