/**
 * Ready-to-use remote MCP servers. Only servers that work with a plain URL plus static headers
 * (API key / token) are listed; OAuth-only servers (Notion, Linear, Sentry, ...) need an
 * interactive sign-in flow we do not run yet. URLs and auth come from each vendor's docs.
 */
export type McpCatalogGroup = "cloudflare" | "dev" | "search" | "business" | "hub" | "builtin";

export interface McpCatalogEntry {
  id: string;
  name: string;
  vendor: string;
  group: McpCatalogGroup;
  description: string;
  transport: "streamable-http" | "sse";
  /** Server URL; may contain a <PLACEHOLDER> the user must replace. */
  url: string;
  /** Header lines prefilled in the form; <PLACEHOLDER> parts must be replaced. Empty = no auth. */
  headers?: string;
  /** One line telling the user where to get the credential. */
  auth: string;
  docs: string;
  /** Built-in bridge instead of an MCP connection: the user adds this Secret and enables it for the bot. */
  secretName?: string;
  /** The server only accepts OAuth sign-in (no static token); easylopster cannot connect it yet. */
  oauthOnly?: boolean;
}

export const MCP_CATALOG_GROUPS: Record<McpCatalogGroup, string> = {
  cloudflare: "Cloudflare",
  dev: "Code and docs",
  search: "Web search and scraping",
  business: "Business",
  hub: "Integration hubs (Google services and 9,000+ apps)",
  builtin: "Built-in bridges (configured with a Secret)",
};

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "cloudflare-api",
    name: "Cloudflare",
    vendor: "Cloudflare",
    group: "cloudflare",
    description: "The whole Cloudflare API: zones, DNS records, Workers, KV, R2, D1, caching, firewall and more.",
    transport: "streamable-http",
    url: "https://mcp.cloudflare.com/mcp",
    headers: "Authorization: Bearer <CLOUDFLARE_API_TOKEN>",
    auth: "Cloudflare dashboard → My Profile → API Tokens (user or account token with the permissions you want the bot to have).",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    vendor: "Cloudflare",
    group: "cloudflare",
    description: "Searches Cloudflare's developer documentation. No account needed.",
    transport: "streamable-http",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "No credentials.",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "cloudflare-browser",
    name: "Cloudflare Browser Rendering",
    vendor: "Cloudflare",
    group: "cloudflare",
    description: "Fetch pages, take screenshots and convert pages to Markdown with Cloudflare's headless browser.",
    transport: "streamable-http",
    url: "https://browser.mcp.cloudflare.com/mcp",
    headers: "Authorization: Bearer <CLOUDFLARE_API_TOKEN>",
    auth: "Cloudflare API token with Browser Rendering permission (OAuth is the documented path; the token header works for API-token-enabled servers).",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "github",
    name: "GitHub",
    vendor: "GitHub",
    group: "dev",
    description: "Repositories, issues, pull requests, code search and Actions workflows.",
    transport: "streamable-http",
    url: "https://api.githubcopilot.com/mcp/",
    headers: "Authorization: Bearer <GITHUB_PERSONAL_ACCESS_TOKEN>",
    auth: "GitHub → Settings → Developer settings → Personal access tokens (fine-grained, scoped to the repos you need).",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "context7",
    name: "Context7",
    vendor: "Upstash",
    group: "dev",
    description: "Up-to-date library and framework documentation for coding questions.",
    transport: "streamable-http",
    url: "https://mcp.context7.com/mcp",
    headers: "Authorization: Bearer <CONTEXT7_API_KEY>",
    auth: "Free key from context7.com (optional; higher rate limits with a key — delete the header to use it anonymously).",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    vendor: "Cognition",
    group: "dev",
    description: "Ask questions about any public GitHub repository and read its generated wiki.",
    transport: "streamable-http",
    url: "https://mcp.deepwiki.com/mcp",
    auth: "No credentials.",
    docs: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    vendor: "Hugging Face",
    group: "dev",
    description: "Search models, datasets, Spaces and papers; run community Gradio tools.",
    transport: "streamable-http",
    url: "https://huggingface.co/mcp",
    headers: "Authorization: Bearer <HF_TOKEN>",
    auth: "huggingface.co → Settings → Access Tokens (read token is enough for search).",
    docs: "https://huggingface.co/docs/hub/en/hf-mcp-server",
  },
  {
    id: "exa",
    name: "Exa Search",
    vendor: "Exa",
    group: "search",
    description: "Neural web search with full-page content, company and people lookups.",
    transport: "streamable-http",
    url: "https://mcp.exa.ai/mcp",
    headers: "x-api-key: <EXA_API_KEY>",
    auth: "API key from dashboard.exa.ai.",
    docs: "https://exa.ai/docs/reference/exa-mcp",
  },
  {
    id: "tavily",
    name: "Tavily",
    vendor: "Tavily",
    group: "search",
    description: "Search, extract, map and crawl the web; built for agents.",
    transport: "streamable-http",
    url: "https://mcp.tavily.com/mcp/?tavilyApiKey=<TAVILY_API_KEY>",
    auth: "API key from app.tavily.com; it goes in the URL as shown.",
    docs: "https://docs.tavily.com/documentation/mcp",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    vendor: "Firecrawl",
    group: "search",
    description: "Scrape, crawl and extract structured data from websites.",
    transport: "streamable-http",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    headers: "Authorization: Bearer <FIRECRAWL_API_KEY>",
    auth: "API key from firecrawl.dev.",
    docs: "https://docs.firecrawl.dev/mcp-server",
  },
  {
    id: "stripe",
    name: "Stripe",
    vendor: "Stripe",
    group: "business",
    description: "Customers, payments, invoices, subscriptions, products and the Stripe docs.",
    transport: "streamable-http",
    url: "https://mcp.stripe.com",
    headers: "Authorization: Bearer <STRIPE_AGENT_API_KEY>",
    auth: "Stripe dashboard → Developers → API keys → create an Agent API key with only the permissions the bot needs (full secret keys stop working on 30 Nov 2026).",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "zapier",
    name: "Zapier MCP",
    vendor: "Zapier",
    group: "hub",
    description: "Gmail, Google Calendar, Sheets, Drive, Slack, Notion, HubSpot and 9,000+ other apps through the actions you enable in Zapier.",
    transport: "streamable-http",
    url: "<PASTE_YOUR_ZAPIER_MCP_SERVER_URL>",
    auth: "zapier.com/mcp → create a server, enable the actions (e.g. Gmail: send email, Google Calendar: create event), copy its server URL (the URL carries its own credential).",
    docs: "https://zapier.com/mcp",
  },
  {
    id: "composio",
    name: "Composio",
    vendor: "Composio",
    group: "hub",
    description: "Google Workspace, Slack, Notion, Jira, Salesforce and hundreds of other toolkits with per-user auth.",
    transport: "streamable-http",
    url: "<PASTE_YOUR_COMPOSIO_MCP_SERVER_URL>",
    headers: "x-api-key: <COMPOSIO_API_KEY>",
    auth: "composio.dev → create an MCP server with the toolkits you want, authenticate the apps, copy the generated per-user URL and your API key.",
    docs: "https://docs.composio.dev/docs/mcp-overview",
  },
];

MCP_CATALOG.push({
  id: "notion",
  name: "Notion",
  vendor: "Notion",
  group: "business",
  description: "Search, read and write Notion pages and databases (Notion MCP, beta).",
  transport: "streamable-http",
  url: "https://mcp.notion.com/mcp",
  auth: "OAuth sign-in only (the server's own authorization flow); an internal integration token is not accepted here. Coming once easylopster supports MCP OAuth.",
  docs: "https://developers.notion.com/guides/mcp/overview",
  oauthOnly: true,
});

MCP_CATALOG.push({
  id: "evernote",
  name: "Evernote",
  vendor: "Evernote",
  group: "business",
  description: "Search, read and create notes and notebooks in Evernote.",
  transport: "streamable-http",
  url: "https://mcp.evernote.com/mcp",
  auth: "Sign-in through Evernote OAuth only (accounts.evernote.com); no API key. Coming once easylopster supports MCP OAuth.",
  docs: "https://mcp.evernote.com/",
  oauthOnly: true,
});

MCP_CATALOG.push({
  id: "namesilo",
  name: "NameSilo",
  vendor: "NameSilo",
  group: "builtin",
  description: "Domains, DNS records, name servers, email forwarding and account balance at NameSilo. Its mcp.namesilo.com endpoint speaks plain JSON-RPC rather than MCP, so easylopster bridges it with a built-in tool.",
  transport: "streamable-http",
  url: "https://mcp.namesilo.com/rpc",
  auth: "NameSilo → account → API Manager → generate an API key. Save it as a Secret named NAMESILO_API_KEY and enable it for the bot; the `namesilo` tool appears on the next message.",
  docs: "https://www.namesilo.com/api-reference",
  secretName: "NAMESILO_API_KEY",
});

export function mcpCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}
