import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true" || v === "on");

export const sharedEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "64 hex chars"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  INTERNAL_SECRET: z.string().min(16).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const betaLimitsSchema = z.object({
  BETA_MAX_BOTS: z.coerce.number().int().positive().default(3),
  BETA_MAX_NODES: z.coerce.number().int().positive().default(2),
  BETA_MAX_MCP: z.coerce.number().int().positive().default(5),
  BETA_MAX_MESSAGES_PER_DAY: z.coerce.number().int().positive().default(500),
});

export const webEnvSchema = sharedEnvSchema.extend({
  GATEWAY_INTERNAL_URL: z.string().url().default("http://localhost:4000"),
  EMAIL_VERIFICATION: z.enum(["on", "off"]).default("off"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
}).merge(betaLimitsSchema);

export const gatewayEnvSchema = sharedEnvSchema.extend({
  GATEWAY_PORT: z.coerce.number().default(4000),
  GATEWAY_WS_URL: z.string().default("ws://localhost:4000/ws"),
  WORKSPACE_ROOT: z.string().default("./data/workspaces"),
}).merge(betaLimitsSchema);

export type WebEnv = z.infer<typeof webEnvSchema>;
export type GatewayEnv = z.infer<typeof gatewayEnvSchema>;

export { boolish };
