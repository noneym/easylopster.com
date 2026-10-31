import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer", "dist/renderer", { recursive: true });
for (const f of ["tray.png", "tray@2x.png", "tray-off.png", "tray-off@2x.png", "trayTemplate.png", "trayTemplate@2x.png", "tray-offTemplate.png", "tray-offTemplate@2x.png", "icon.png"]) cpSync(`build/${f}`, `dist/${f}`);
