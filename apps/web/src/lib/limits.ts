import "server-only";
import { globalLimits, limitsFor as resolve, type LimitOverrides, type Limits } from "@easylopster/shared/limits";

export type { Limits, LimitOverrides };

/** Global beta quotas from env (BETA_MAX_*). Prefer `limitsFor(user)` so admin overrides apply. */
export const LIMITS: Limits = globalLimits();

/** Effective quotas for a user: admin override when set, else the global default. */
export function limitsFor(user: LimitOverrides | null | undefined): Limits {
  return resolve(user, LIMITS);
}
