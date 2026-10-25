/**
 * Per-account quotas. The global beta defaults come from the environment (BETA_MAX_*); an admin can
 * raise or lower them per user through the nullable override columns on User (limitBots, limitNodes,
 * limitMcp, limitMessagesPerDay). `limitsFor(user)` resolves the effective values.
 */
export interface Limits {
  bots: number;
  nodes: number;
  mcp: number;
  messagesPerDay: number;
}

export interface LimitOverrides {
  limitBots?: number | null;
  limitNodes?: number | null;
  limitMcp?: number | null;
  limitMessagesPerDay?: number | null;
}

/** Global beta defaults, read from the environment at call time. */
export function globalLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
  };
  return {
    bots: n(env.BETA_MAX_BOTS, 3),
    nodes: n(env.BETA_MAX_NODES, 2),
    mcp: n(env.BETA_MAX_MCP, 5),
    messagesPerDay: n(env.BETA_MAX_MESSAGES_PER_DAY, 500),
  };
}

/** Effective limits for a user: per-user override when set, else the global default. */
export function limitsFor(user: LimitOverrides | null | undefined, base: Limits = globalLimits()): Limits {
  const pick = (o: number | null | undefined, d: number) => (typeof o === "number" && Number.isFinite(o) && o >= 0 ? o : d);
  return {
    bots: pick(user?.limitBots, base.bots),
    nodes: pick(user?.limitNodes, base.nodes),
    mcp: pick(user?.limitMcp, base.mcp),
    messagesPerDay: pick(user?.limitMessagesPerDay, base.messagesPerDay),
  };
}
