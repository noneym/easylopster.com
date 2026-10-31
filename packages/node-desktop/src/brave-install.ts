/**
 * Installs Brave on this computer when browser control is wanted but Brave is missing.
 *  - Windows: winget (present on current Windows 10/11), else Brave's standalone installer run silently.
 *  - macOS: Homebrew (`brew install --cask brave-browser`) when present, else Brave's DMG
 *    (arm64 or Intel) mounted with hdiutil and copied to /Applications (or ~/Applications when
 *    /Applications is not writable for this user).
 * One install at a time; callers get a status object so the agent can be told "installing, try again in a minute".
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { constants as FS } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { findBrave } from "./browser";

const WIN_INSTALLER_URL = "https://laptop-updates.brave.com/latest/winx64";
const MAC_DMG_URL = process.arch === "arm64" ? "https://laptop-updates.brave.com/latest/osxarm64" : "https://laptop-updates.brave.com/latest/osx";

export interface InstallState {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  method?: "winget" | "installer" | "homebrew" | "dmg";
  error?: string;
  installedPath?: string;
}

const state: InstallState = { running: false };
let current: Promise<InstallState> | null = null;

export function braveInstallState(): InstallState {
  return { ...state };
}

function run(cmd: string, args: string[], log: (l: string) => void, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const push = (b: Buffer) => {
      out += b.toString();
      if (out.length > 20_000) out = out.slice(-20_000);
    };
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve({ code: null, out: out + "\n[timed out]" });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, out: out + "\n" + err.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      log(`brave-install: ${path.basename(cmd)} ${args[0] ?? ""} exited ${code}`);
      resolve({ code, out });
    });
  });
}

function download(url: string, dest: string, log: (l: string) => void, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "easylopster-node" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
          res.resume();
          return void download(new URL(res.headers.location, url).toString(), dest, log, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers["content-length"] ?? 0);
        let got = 0;
        let lastPct = -10;
        const file = createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          got += chunk.length;
          if (total) {
            const pct = Math.floor((got / total) * 100);
            if (pct >= lastPct + 25) {
              lastPct = pct;
              log(`brave-install: downloading ${pct}%`);
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function waitForBrave(ms: number): Promise<string | undefined> {
  const deadline = Date.now() + ms;
  let found = findBrave();
  while (!found && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    found = findBrave();
  }
  return found;
}

async function installWindows(log: (l: string) => void): Promise<string> {
  const probe = await run("winget", ["--version"], log, 20_000);
  if (probe.code === 0) {
    state.method = "winget";
    log("brave-install: installing Brave with winget");
    const r = await run("winget", ["install", "--id", "Brave.Brave", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], log, 10 * 60_000);
    const found = findBrave();
    if (found) return found;
    log(`brave-install: winget did not produce brave.exe (exit ${r.code}); trying the standalone installer`);
  } else log("brave-install: winget not available; using the standalone installer");
  state.method = "installer";
  const dir = path.join(os.tmpdir(), "easylopster-brave-install");
  await mkdir(dir, { recursive: true });
  const exe = path.join(dir, "BraveBrowserSetup.exe");
  await download(WIN_INSTALLER_URL, exe, log);
  log("brave-install: running the Brave installer silently");
  const r = await run(exe, ["/silent", "/install"], log, 10 * 60_000);
  // The installer may hand off to a child process; give it a moment to finish.
  const found = await waitForBrave(90_000);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  if (!found) throw new Error(`Brave installer finished (exit ${r.code}) but brave.exe was not found; install Brave manually from brave.com`);
  return found;
}

function brewPath(): string | undefined {
  return ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find((p) => existsSync(p));
}

async function installMac(log: (l: string) => void): Promise<string> {
  const brew = brewPath();
  if (brew) {
    state.method = "homebrew";
    log("brave-install: installing Brave with Homebrew (brew install --cask brave-browser)");
    const r = await run(brew, ["install", "--cask", "brave-browser"], log, 15 * 60_000);
    const found = findBrave();
    if (found) return found;
    log(`brave-install: Homebrew did not produce Brave (exit ${r.code}); downloading the DMG instead`);
  } else log("brave-install: Homebrew not found; downloading Brave's DMG");

  state.method = "dmg";
  const dir = path.join(os.tmpdir(), "easylopster-brave-install");
  const mount = path.join(dir, "mnt");
  await mkdir(mount, { recursive: true });
  const dmg = path.join(dir, "Brave-Browser.dmg");
  try {
    await download(MAC_DMG_URL, dmg, log);
    log("brave-install: mounting the DMG");
    const att = await run("/usr/bin/hdiutil", ["attach", dmg, "-nobrowse", "-noautoopen", "-quiet", "-mountpoint", mount], log, 5 * 60_000);
    if (att.code !== 0) throw new Error(`hdiutil attach failed: ${att.out.trim().slice(-300)}`);
    const src = path.join(mount, "Brave Browser.app");
    if (!existsSync(src)) throw new Error("the DMG does not contain Brave Browser.app");
    // /Applications is writable for admin users; others get ~/Applications (Brave runs from either).
    let target = "/Applications";
    try {
      await access(target, FS.W_OK);
    } catch {
      target = path.join(os.homedir(), "Applications");
      await mkdir(target, { recursive: true });
    }
    log(`brave-install: copying Brave Browser.app to ${target}`);
    const cp = await run("/usr/bin/ditto", [src, path.join(target, "Brave Browser.app")], log, 10 * 60_000);
    if (cp.code !== 0) throw new Error(`copy failed: ${cp.out.trim().slice(-300)}`);
    // Downloaded by us, not the browser: no quarantine prompt for a file the user did not open, but clear it anyway.
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", path.join(target, "Brave Browser.app")], log, 60_000);
  } finally {
    await run("/usr/bin/hdiutil", ["detach", mount, "-quiet", "-force"], () => {}, 60_000).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  const found = await waitForBrave(10_000);
  if (!found) throw new Error("Brave was copied but could not be found; install Brave manually from brave.com");
  return found;
}

/** Starts (or joins) an installation; resolves when it ends. Call `braveInstallState()` for progress meanwhile. */
export function installBrave(log: (l: string) => void): Promise<InstallState> {
  if (current) return current;
  const p = (async (): Promise<InstallState> => {
    state.running = true;
    state.startedAt = Date.now();
    state.finishedAt = undefined;
    state.error = undefined;
    state.installedPath = undefined;
    try {
      let found: string;
      if (process.platform === "win32") found = await installWindows(log);
      else if (process.platform === "darwin") found = await installMac(log);
      else throw new Error("automatic Brave install is available on Windows and macOS; install Brave with your package manager");
      state.installedPath = found;
      log(`brave-install: Brave installed (${found})`);
    } catch (err) {
      state.error = (err as Error).message;
      log(`brave-install: failed: ${state.error}`);
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
      current = null;
    }
    return { ...state };
  })();
  current = p;
  return p;
}
