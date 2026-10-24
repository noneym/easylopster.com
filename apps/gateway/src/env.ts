import { gatewayEnvSchema, type GatewayEnv } from "@easylopster/shared/env";

let cached: GatewayEnv | undefined;

export function env(): GatewayEnv {
  if (!cached) {
    const parsed = gatewayEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("Invalid gateway environment:", parsed.error.flatten().fieldErrors);
      process.exit(1);
    }
    cached = parsed.data;
  }
  return cached;
}
