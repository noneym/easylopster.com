import { defineConfig } from "tsdown";

// Everything except electron itself is bundled, so the packaged app ships no node_modules.
export default defineConfig([
  {
    entry: { main: "src/main.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: true,
    dts: false,
    noExternal: [/^@easylopster\//, /^easylopster-node/, "ws", "zod", /^electron-updater/, /^builder-util-runtime/],
    external: ["electron", "bufferutil", "utf-8-validate"],
    outExtensions: () => ({ js: ".cjs" }),
  },
  {
    entry: { preload: "src/preload.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: false,
    dts: false,
    external: ["electron"],
    outExtensions: () => ({ js: ".cjs" }),
  },
]);
