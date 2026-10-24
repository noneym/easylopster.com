import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { McpForm } from "../mcp-form";

export const metadata = { title: "Add MCP server" };

export default async function NewMcpPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Add MCP server" description="Remote Model Context Protocol servers over Streamable HTTP or SSE. We connect, list the tools and remember them." />
      <McpForm />
    </>
  );
}
