import { PrismaClient } from "../generated/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { PoolConfig } from "mariadb";

export * from "../generated/client.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Pool settings tuned so a silently dropped connection is detected and replaced instead of
 * poisoning the pool (socketTimeout, keepAlive, idleTimeout, queryTimeout, leak detection).
 */
function poolConfig(url: string): PoolConfig {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || undefined,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    minimumIdle: 1,
    acquireTimeout: 20_000,
    connectTimeout: 5_000,
    socketTimeout: 60_000,
    keepAliveDelay: 10_000,
    idleTimeout: 30,
    queryTimeout: 30_000,
    leakDetectionTimeout: 30_000,
  };
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaMariaDb(poolConfig(url));
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = create();
  return globalForPrisma.prisma;
}

/** Lazily constructed so `next build` never opens a connection. */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
