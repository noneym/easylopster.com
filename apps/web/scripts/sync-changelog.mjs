// Copies the repo CHANGELOG.md into a TS module so the /changelog page can render it without
// runtime file access (the standalone build only ships traced files). Runs before dev and build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const md = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
mkdirSync(path.join(import.meta.dirname, "../src/generated"), { recursive: true });
writeFileSync(path.join(import.meta.dirname, "../src/generated/changelog.ts"), `// Generated from CHANGELOG.md by scripts/sync-changelog.mjs. Do not edit.\nexport const CHANGELOG_MD = ${JSON.stringify(md)};\n`);
console.log("changelog synced");
