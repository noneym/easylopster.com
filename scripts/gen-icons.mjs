// Generates every raster brand asset from the claw-bubble mark (brand sheet "01 Claw bubble").
// Run: node scripts/gen-icons.mjs   (then python scripts/gen-ico.py for the .ico files)
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = "#FF4F2E";
const INK = "#111214";
const BUBBLE = 'M62 60 L96.37 37 A42 42 0 1 0 100.57 68.87 Z';
const TAIL = 'M32 86 L16 108 L46 96 Z';
const TEETH = 'M71.97 53.32 L78.62 48.87 L78.64 56.09 Z M81.95 46.65 L88.6 42.2 L88.61 49.42 Z';

/** Mark alone (transparent background). */
const mark = (fill, teeth = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="${BUBBLE}" fill="${fill}"/><path d="${TAIL}" fill="${fill}"/>${teeth ? `<path d="${TEETH}" fill="${fill}"/>` : ""}</svg>`;

/** App-icon tile: accent rounded square, white mark at 68%. Tile radius 22.7% (40/176). */
const tile = (size, teeth = size >= 64, bg = ACCENT, fg = "#FFFFFF", round = true) => {
  const r = round ? Math.round(size * 0.227) : 0;
  const m = Math.round(size * 0.68);
  const o = Math.round((size - m) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/><svg x="${o}" y="${o}" width="${m}" height="${m}" viewBox="0 0 120 120"><path d="${BUBBLE}" fill="${fg}"/><path d="${TAIL}" fill="${fg}"/>${teeth ? `<path d="${TEETH}" fill="${fg}"/>` : ""}</svg></svg>`;
};

/** Round avatar: ink circle, accent mark (Telegram bot avatar). */
const avatar = (size) => {
  const m = Math.round(size * 0.64);
  const o = Math.round((size - m) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${INK}"/><svg x="${o}" y="${o}" width="${m}" height="${m}" viewBox="0 0 120 120"><path d="${BUBBLE}" fill="${ACCENT}"/><path d="${TAIL}" fill="${ACCENT}"/><path d="${TEETH}" fill="${ACCENT}"/></svg></svg>`;
};

const png = async (svg, out, size) => {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
};

// ── web ──
const web = "apps/web";
mkdirSync(`${web}/public/brand`, { recursive: true });
writeFileSync(`${web}/public/brand/mark.svg`, mark(ACCENT));
writeFileSync(`${web}/public/brand/mark-white.svg`, mark("#FFFFFF"));
writeFileSync(`${web}/public/brand/app-icon.svg`, tile(512));
await png(tile(512), `${web}/src/app/icon.png`, 512);
await png(tile(180, true, ACCENT, "#FFFFFF", false), `${web}/src/app/apple-icon.png`, 180);
await png(avatar(640), `${web}/public/brand/bot-avatar.png`, 640);
for (const s of [16, 32, 48]) await png(tile(s, s >= 64), `${web}/public/brand/favicon-${s}.png`, s);

// Open Graph card: ink background, lockup + tagline (text as SVG; Bricolage not available to sharp, so a geometric fallback)
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${INK}"/><svg x="96" y="200" width="150" height="150" viewBox="0 0 120 120"><path d="${BUBBLE}" fill="${ACCENT}"/><path d="${TAIL}" fill="${ACCENT}"/><path d="${TEETH}" fill="${ACCENT}"/></svg><text x="280" y="300" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="104" font-weight="700" letter-spacing="-4" fill="#F4F3F0">easylopster</text><text x="284" y="372" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="36" fill="#A9A6A0">An AI assistant that lives in your Telegram.</text><text x="96" y="560" font-family="Consolas, monospace" font-size="22" letter-spacing="2" fill="#5A5650">EASYLOPSTER.COM · BRING YOUR OWN KEY · FREE BETA</text></svg>`;
await sharp(Buffer.from(og)).png().toFile(`${web}/src/app/opengraph-image.png`);
console.log("wrote opengraph-image.png");

// ── desktop (tray + installer) ──
const d = "packages/node-desktop/build";
mkdirSync(d, { recursive: true });
await png(tile(256), `${d}/icon.png`, 256);
for (const s of [16, 24, 32, 48, 64, 128, 256]) await png(tile(s, s >= 64), `${d}/ico-${s}.png`, s);
await png(tile(16, false), `${d}/tray.png`, 16);
await png(tile(32, false), `${d}/tray@2x.png`, 32);
await png(tile(16, false, "#8A867F"), `${d}/tray-off.png`, 16);
await png(tile(32, false, "#8A867F"), `${d}/tray-off@2x.png`, 32);

// ── macOS: app icon (1024, Big Sur-style inset on a transparent canvas) and menu-bar template images ──
const macIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><svg x="100" y="100" width="824" height="824" viewBox="0 0 824 824">${tile(824).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</svg></svg>`;
await png(macIcon, `${d}/icon-mac.png`, 1024);
// Template images: black + alpha only; macOS tints them for light/dark menu bars. "off" is the same mark at 45% alpha.
const tmpl = (alpha) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><g fill="#000000" fill-opacity="${alpha}"><path d="${BUBBLE}"/><path d="${TAIL}"/><path d="${TEETH}"/></g></svg>`;
await png(tmpl(1), `${d}/trayTemplate.png`, 18);
await png(tmpl(1), `${d}/trayTemplate@2x.png`, 36);
await png(tmpl(0.45), `${d}/tray-offTemplate.png`, 18);
await png(tmpl(0.45), `${d}/tray-offTemplate@2x.png`, 36);
console.log("wrote macOS icons");
