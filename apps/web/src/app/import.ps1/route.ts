import { appOrigin, importPs1 } from "@/lib/import-scripts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(importPs1(appOrigin(req)), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
