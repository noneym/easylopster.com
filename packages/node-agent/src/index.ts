#!/usr/bin/env node
/**
 * easylopster node agent.
 *
 *   easylopster-node connect <PAIRING-CODE> [--gateway wss://gw.easylopster.com/ws] [--workspace ./dir] [--name laptop]
 *   easylopster-node run                     (uses the saved token, or EASYLOPSTER_TOKEN)
 *   easylopster-node status
 *
 * Environment (Docker friendly): EASYLOPSTER_GATEWAY, EASYLOPSTER_PAIRING_CODE, EASYLOPSTER_TOKEN,
 * EASYLOPSTER_WORKSPACE, EASYLOPSTER_NAME, EASYLOPSTER_CONFIG (config file path).
 *
 * The agent opens one outbound WebSocket, declares its capabilities and answers requests
 * (fs.*, exec, system.which, system.notify, device.info). Every path is jailed to --workspace.
 */
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import WebSocket from "ws";
import { PROTOCOL_VERSION, gatewayToNodeFrameSchema, type NodeCapability, type NodeToGatewayFrame } from "@easylopster/shared/node-protocol";
import { APP_VERSION } from "@easylopster/shared/version";

const VERSION = APP_VERSION;
const DEFAULT_GATEWAY = "wss://gw.easylopster.com/ws";
const CAPS: NodeCapability[] = ["fs.read", "fs.write", "fs.list", "fs.search", "exec", "system.which", "system.notify", "device.info"];
const MAX_OUTPUT = 24_000;

interface Config {
  gateway: string;
  token?: string;
  workspace: string;
  name: string;
}

const log = (m: string) => console.log(`[easylopster-node] ${new Date().toISOString()} ${m}`);

// ───────────────────────── config ─────────────────────────
const configPath = process.env.EASYLOPSTER_CONFIG ?? (existsSync("/data") && process.platform === "linux" ? "/data/node.json" : path.join(os.homedir(), ".easylopster", "node.json"));

async function loadConfig(): Promise<Partial<Config>> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Partial<Config>;
  } catch {
    return {};
  }
}
async function saveConfig(c: Config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(c, null, 2), { mode: 0o600 });
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function platform(): "windows" | "macos" | "linux" | "docker" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return existsSync("/.dockerenv") ? "docker" : "linux";
}

// ───────────────────────── handlers ─────────────────────────
function jail(root: string, rel: string): string {
  const abs = path.resolve(root, (rel ?? ".").replace(/^[\\/]+/, ""));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Path escapes the shared folder: ${rel}`);
  return abs;
}

async function listDir(root: string, rel: string, depth: number) {
  const out: { path: string; type: "file" | "dir"; size: number }[] = [];
  const walk = async (dir: string, d: number) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
      const abs = path.join(dir, e.name);
      const relPath = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        out.push({ path: relPath + "/", type: "dir", size: 0 });
        if (d > 0) await walk(abs, d - 1);
      } else {
        const s = await stat(abs).catch(() => null);
        out.push({ path: relPath, type: "file", size: s?.size ?? 0 });
      }
      if (out.length >= 500) return;
    }
  };
  await walk(jail(root, rel), depth);
  return { entries: out };
}

async function search(root: string, query: string, maxResults: number) {
  const hits: { path: string; line: number; text: string }[] = [];
  const needle = query.toLowerCase();
  const { entries } = await listDir(root, ".", 6);
  for (const f of entries) {
    if (f.type !== "file" || f.size > 2_000_000) continue;
    const text = await readFile(jail(root, f.path), "utf8").catch(() => null);
    if (text == null || text.includes("\0")) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        hits.push({ path: f.path, line: i + 1, text: lines[i]!.trim().slice(0, 300) });
        if (hits.length >= maxResults) return { hits };
      }
    }
  }
  return { hits };
}

function exec(root: string, command: string, timeoutSec = 60, cwd?: string, extraEnv: Record<string, string> = {}) {
  const dir = cwd ? jail(root, cwd) : root;
  const isWin = process.platform === "win32";
  const env = { ...process.env, ...extraEnv };
  const child = isWin
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: dir, windowsHide: true, env })
    : spawn("bash", ["-lc", command], { cwd: dir, env });
  let stdout = "";
  let stderr = "";
  const started = Date.now();
  child.stdout.on("data", (b: Buffer) => (stdout.length < MAX_OUTPUT ? (stdout += b.toString("utf8")) : null));
  child.stderr.on("data", (b: Buffer) => (stderr.length < MAX_OUTPUT ? (stderr += b.toString("utf8")) : null));
  return new Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number }>((resolve) => {
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.min(Math.max(timeoutSec, 1), 300) * 1000);
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ exitCode: code ?? -1, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), timedOut, durationMs: Date.now() - started });
    });
    child.on("error", (err) => {
      clearTimeout(t);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut: false, durationMs: Date.now() - started });
    });
  });
}

async function which(name: string) {
  if (!/^[\w.+-]+$/.test(name)) return { found: false, error: "invalid name" };
  const r = process.platform === "win32" ? await exec(os.tmpdir(), `(Get-Command ${name} -ErrorAction SilentlyContinue).Source`, 10) : await exec(os.tmpdir(), `command -v ${name}`, 10);
  const p = r.stdout.trim().split(/\r?\n/)[0] ?? "";
  return { found: !!p, path: p || undefined };
}

async function notify(title: string, body: string) {
  const esc = (s: string) => s.replace(/["`$\\]/g, "");
  try {
    if (process.platform === "darwin") await exec(os.tmpdir(), `osascript -e 'display notification "${esc(body)}" with title "${esc(title)}"'`, 10);
    else if (process.platform === "win32")
      await exec(
        os.tmpdir(),
        `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, "${esc(title)}", "${esc(body)}", [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 8; $n.Dispose()`,
        20,
      );
    else await exec(os.tmpdir(), `notify-send "${esc(title)}" "${esc(body)}"`, 10);
    log(`notification: ${title}: ${body}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function deviceInfo(root: string) {
  return {
    hostname: os.hostname(),
    platform: platform(),
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1e9),
    freeMemoryGb: Math.round(os.freemem() / 1e9),
    uptimeHours: Math.round(os.uptime() / 3600),
    user: os.userInfo().username,
    workspace: root,
    agentVersion: VERSION,
  };
}

async function handle(root: string, method: NodeCapability, p: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "fs.read": {
      const text = await readFile(jail(root, String(p.path)), "utf8");
      return { path: p.path, content: text.length > 60_000 ? text.slice(0, 60_000) + "\n[...truncated]" : text };
    }
    case "fs.write": {
      const abs = jail(root, String(p.path));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, String(p.content ?? ""), "utf8");
      return { ok: true, path: p.path };
    }
    case "fs.list":
      return listDir(root, String(p.path ?? "."), Number(p.depth ?? 1));
    case "fs.search":
      return search(root, String(p.query), Number(p.maxResults ?? 40));
    case "exec":
      return exec(root, String(p.command), p.timeoutSec ? Number(p.timeoutSec) : 60, p.cwd ? String(p.cwd) : undefined, (p.env && typeof p.env === "object" ? (p.env as Record<string, string>) : {}));
    case "system.which":
      return which(String(p.name));
    case "system.notify":
      return notify(String(p.title ?? "easylopster"), String(p.body ?? ""));
    case "device.info":
      return deviceInfo(root);
    default:
      throw new Error(`Unsupported method ${method}`);
  }
}

// ───────────────────────── connection ─────────────────────────
async function runAgent(cfg: Config, pairingCode?: string): Promise<never> {
  await mkdir(cfg.workspace, { recursive: true });
  let backoff = 1000;
  let usePairing = !!pairingCode && !cfg.token;

  while (true) {
    await new Promise<void>((resolve) => {
      log(`connecting to ${cfg.gateway} (${usePairing ? "pairing" : "token"})`);
      const ws = new WebSocket(cfg.gateway, { handshakeTimeout: 15_000 });
      const send = (f: NodeToGatewayFrame) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(f));
      let connected = false;

      ws.on("open", () => {
        send({
          type: "connect",
          v: PROTOCOL_VERSION,
          role: "node",
          auth: usePairing ? { kind: "pairing", code: pairingCode! } : { kind: "token", token: cfg.token! },
          node: { name: cfg.name, platform: platform(), arch: os.arch(), agentVersion: VERSION, caps: CAPS, workspaceRoot: cfg.workspace },
        });
      });

      ws.on("message", async (raw) => {
        let frame;
        try {
          frame = gatewayToNodeFrameSchema.parse(JSON.parse(raw.toString()));
        } catch {
          return;
        }
        if (frame.type === "connected") {
          connected = true;
          backoff = 1000;
          if (frame.token) {
            cfg.token = frame.token;
            usePairing = false;
            await saveConfig(cfg);
            log(`paired; token saved to ${configPath}`);
          }
          log(`online as node ${frame.nodeId}; sharing ${cfg.workspace}`);
        } else if (frame.type === "ping") {
          send({ type: "pong", t: frame.t });
        } else if (frame.type === "req") {
          const started = Date.now();
          try {
            const payload = await handle(cfg.workspace, frame.method, frame.params);
            send({ type: "res", id: frame.id, ok: true, payload });
            log(`${frame.method} ok ${Date.now() - started}ms`);
          } catch (err) {
            send({ type: "res", id: frame.id, ok: false, error: { code: "failed", message: (err as Error).message } });
            log(`${frame.method} failed: ${(err as Error).message}`);
          }
        } else if (frame.type === "error") {
          log(`gateway error: ${frame.code} ${frame.message}`);
          if (frame.code === "auth_failed") {
            console.error("Authentication failed. Get a new pairing code from the dashboard and run `connect <CODE>` again.");
            process.exit(2);
          }
        }
      });

      ws.on("close", (code, reason) => {
        log(`disconnected (${code} ${reason.toString()})`);
        resolve();
      });
      ws.on("error", (err) => log(`socket error: ${err.message}`));
      process.once("SIGINT", () => {
        ws.close(1000, "agent stopped");
        process.exit(0);
      });
      void connected;
    });
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}

async function main() {
  const cmd = process.argv[2] ?? (process.env.EASYLOPSTER_PAIRING_CODE || process.env.EASYLOPSTER_TOKEN ? "run" : "help");
  const saved = await loadConfig();
  const cfg: Config = {
    gateway: arg("--gateway") ?? process.env.EASYLOPSTER_GATEWAY ?? saved.gateway ?? DEFAULT_GATEWAY,
    token: process.env.EASYLOPSTER_TOKEN ?? saved.token,
    workspace: path.resolve((arg("--workspace") ?? process.env.EASYLOPSTER_WORKSPACE ?? saved.workspace ?? (existsSync("/data") ? "/data/workspace" : path.join(os.homedir(), "easylopster"))).replace(/^~(?=$|[\\/])/, os.homedir())),
    name: arg("--name") ?? process.env.EASYLOPSTER_NAME ?? saved.name ?? os.hostname(),
  };

  if (cmd === "connect") {
    const code = (process.argv[3] ?? process.env.EASYLOPSTER_PAIRING_CODE ?? "").toUpperCase();
    if (!code) return console.error("usage: easylopster-node connect <PAIRING-CODE> [--gateway url] [--workspace dir] [--name name]");
    cfg.token = undefined;
    await saveConfig(cfg);
    await runAgent(cfg, code);
  } else if (cmd === "run") {
    if (!cfg.token && process.env.EASYLOPSTER_PAIRING_CODE) {
      await saveConfig(cfg);
      await runAgent(cfg, process.env.EASYLOPSTER_PAIRING_CODE.toUpperCase());
    }
    if (!cfg.token) return console.error("No token saved. Run `easylopster-node connect <PAIRING-CODE>` first.");
    await runAgent(cfg);
  } else if (cmd === "status") {
    console.log(JSON.stringify({ configPath, gateway: cfg.gateway, workspace: cfg.workspace, name: cfg.name, paired: !!cfg.token, version: VERSION }, null, 2));
  } else {
    console.log(`easylopster-node ${VERSION}

  connect <PAIRING-CODE> [--gateway url] [--workspace dir] [--name name]   pair this machine
  run                                                                      start with the saved token
  status                                                                   show configuration

Config: ${configPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
