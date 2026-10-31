import { appOrigin, importMjs } from "@/lib/import-scripts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(importMjs(appOrigin(req)), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
}
