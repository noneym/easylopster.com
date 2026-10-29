/**
 * Installs Brave on this PC when browser control is wanted but brave.exe is missing.
 * First choice is winget (present on current Windows 10/11); fallback is Brave's standalone
 * installer downloaded from laptop-updates.brave.com and run silently. One install at a time;
 * callers get a status object so the agent can be told "installing, try again in a minute".
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { findBrave } from "./browser";

const STANDALONE_URL = "https://laptop-updates.brave.com/latest/winx64";

export interface InstallState {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  method?: "winget" | "installer";
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
      log(`brave-install: ${cmd} exited ${code}`);
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
              log(`brave-install: downloading installer ${pct}%`);
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
      if (process.platform !== "win32") throw new Error("automatic Brave install is only implemented on Windows");
      // 1) winget
      const probe = await run("winget", ["--version"], log, 20_000);
      if (probe.code === 0) {
        state.method = "winget";
        log("brave-install: installing Brave with winget");
        const r = await run("winget", ["install", "--id", "Brave.Brave", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], log, 10 * 60_000);
        const found = findBrave();
        if (found) {
          state.installedPath = found;
          log(`brave-install: Brave installed via winget (${found})`);
          return { ...state, running: false, finishedAt: Date.now() };
        }
        log(`brave-install: winget did not produce brave.exe (exit ${r.code}); trying the standalone installer`);
      } else {
        log("brave-install: winget not available; using the standalone installer");
      }
      // 2) standalone installer
      state.method = "installer";
      const dir = path.join(os.tmpdir(), "easylopster-brave-install");
      await mkdir(dir, { recursive: true });
      const exe = path.join(dir, "BraveBrowserSetup.exe");
      await download(STANDALONE_URL, exe, log);
      log("brave-install: running the Brave installer silently");
      const r = await run(exe, ["/silent", "/install"], log, 10 * 60_000);
      // The installer may hand off to a child process; give it a moment to finish.
      const deadline = Date.now() + 90_000;
      let found = findBrave();
      while (!found && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 2000));
        found = findBrave();
      }
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      if (!found) throw new Error(`Brave installer finished (exit ${r.code}) but brave.exe was not found; install Brave manually from brave.com`);
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
