import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  // Bundle our workspace packages (they ship TS sources, including subpath imports), keep npm deps external.
  noExternal: [/^@easylopster\//],
});
