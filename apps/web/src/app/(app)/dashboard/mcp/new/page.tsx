import { mcpCatalogEntry } from "@easylopster/shared/mcp-catalog";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { McpForm } from "../mcp-form";

export const metadata = { title: "Add MCP server" };

export default async function NewMcpPage({ searchParams }: PageProps<"/dashboard/mcp/new">) {
  await requireUser();
  const sp = await searchParams;
  const preset = typeof sp.preset === "string" ? mcpCatalogEntry(sp.preset) : undefined;
  return (
    <>
      <PageHeader
        title={preset ? `Add ${preset.name}` : "Add MCP server"}
        description={preset ? preset.description : "Remote Model Context Protocol servers over Streamable HTTP or SSE. We connect, list the tools and remember them."}
      />
      <McpForm
        key={preset?.id ?? "blank"}
        initial={{
          name: preset?.name ?? "",
          transport: preset?.transport ?? "streamable-http",
          url: preset?.url ?? "",
          headers: preset?.headers ?? "",
          preset: preset ? { name: preset.name, auth: preset.auth, docs: preset.docs } : undefined,
          oauth: preset?.oauthOnly ? { vendor: preset.vendor } : undefined,
          error: typeof sp.error === "string" ? sp.error : undefined,
        }}
      />
    </>
  );
}
