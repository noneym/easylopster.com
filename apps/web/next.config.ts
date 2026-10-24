import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Monorepo: trace files from the repo root so workspace packages land in .next/standalone
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  serverExternalPackages: ["@prisma/adapter-mariadb", "mariadb", "argon2", "nodemailer", "bullmq", "ioredis", "@modelcontextprotocol/sdk"],
  // Workspace packages ship TypeScript sources; let Next compile them.
  transpilePackages: ["@easylopster/shared", "@easylopster/db"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
