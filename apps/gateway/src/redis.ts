import { Redis } from "ioredis";
import { env } from "./env.ts";

/** BullMQ needs maxRetriesPerRequest=null on its connections. */
export function createRedis(): Redis {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

let shared: Redis | undefined;
export function redis(): Redis {
  if (!shared) shared = createRedis();
  return shared;
}
