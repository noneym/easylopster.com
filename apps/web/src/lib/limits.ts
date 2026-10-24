/** Beta quotas, read from env with sane defaults. */
export const LIMITS = {
  bots: Number(process.env.BETA_MAX_BOTS ?? 3),
  nodes: Number(process.env.BETA_MAX_NODES ?? 2),
  mcp: Number(process.env.BETA_MAX_MCP ?? 5),
  messagesPerDay: Number(process.env.BETA_MAX_MESSAGES_PER_DAY ?? 500),
};
