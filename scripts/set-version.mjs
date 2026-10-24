// Usage: node scripts/set-version.mjs 1.2.3
// Writes the version into packages/shared/src/version.ts and every workspace package.json.
import { readFileSync, writeFileSync } from "node:fs";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v ?? "")) {
  console.error("usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}
const files = ["package.json", "apps/web/package.json", "apps/gateway/package.json", "packages/db/package.json", "packages/shared/package.json", "packages/node-agent/package.json"];
for (const f of files) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  j.version = v;
  writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
}
writeFileSync("packages/shared/src/version.ts", `/** Single source of truth for the product version; \`pnpm version:set <x.y.z>\` keeps package.json files in sync. */\nexport const APP_VERSION = "${v}";\n`);
console.log(`version set to ${v} in ${files.length} packages`);
