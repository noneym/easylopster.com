import { appOrigin, importSh } from "@/lib/import-scripts";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(importSh(appOrigin(req)), { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" } });
}
