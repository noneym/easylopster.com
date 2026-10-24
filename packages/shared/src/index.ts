export * from "./crypto.js";
export * from "./providers.js";
export * from "./env.js";
export * from "./node-protocol.js";

/** BullMQ queue names shared by web (producer) and gateway (consumer). */
export const QUEUES = {
  inbound: "inbound", // one job per inbound message (telegram/web)
  outbound: "outbound", // deliveries that must survive a gateway restart
} as const;

export const BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"] as const;
export const BOOTSTRAP_MAX_CHARS_PER_FILE = 20_000;
export const BOOTSTRAP_MAX_CHARS_TOTAL = 60_000;

export const TELEGRAM_MAX_MESSAGE = 4096;
