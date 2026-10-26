/**
 * easylopster node agent as a library. The CLI (index.ts) and the Windows tray app
 * (packages/node-desktop) both drive this.
 *
 * The agent opens one outbound WebSocket, declares its capabilities and answers requests
 * (fs.*, exec, system.which, system.notify, device.info). Every path is jailed to the workspace.
 */
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import WebSocket from "ws";
import { PROTOCOL_VERSION, gatewayToNodeFrameSchema, type NodeCapability, type NodeToGatewayFrame } from "@easylopster/shared/node-protocol";
import { APP_VERSION } from "@easylopster/shared/version";

export const VERSION = APP_VERSION;
export const DEFAULT_GATEWAY = "wss://gw.easylopster.com/ws";
export const BASE_CAPS: NodeCapability[] = ["fs.read", "fs.write", "fs.list", "fs.search", "exec", "exec.jobs", "system.which", "system.notify", "device.info"];
const MAX_OUTPUT = 24_000;

export interface NodeConfig {
  gateway: string;
  token?: string;
  workspace: string;
  name: string;
}

export type AgentState = "stopped" | "connecting" | "pairing" | "online" | "offline" | "auth_failed";

export interface AgentStatus {
  state: AgentState;
  nodeId?: string;
  lastError?: string;
  since: number;
}

/** Extra request handler for capabilities outside BASE_CAPS. */
export type ExtraHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface AgentOptions {
  config: NodeConfig;
  configPath: string;
  /** Pairing code for the first connect (ignored once a token is saved). */
  pairingCode?: string;
  log?: (line: string) => void;
  onStatus?: (s: AgentStatus) => void;
  /** Capabilities declared in addition to BASE_CAPS (served by `extra`). */
  extraCaps?: NodeCapability[];
  extra?: ExtraHandler;
  /** Overrides the built-in system.notify (the tray app uses native notifications). */
  notify?: (title: string, body: string) => Promise<void>;
}

// ───────────────────────── config ─────────────────────────
export function defaultConfigPath() {
  return process.env.EASYLOPSTER_CONFIG ?? (existsSync("/data") && process.platform === "linux" ? "/data/node.json" : path.join(os.homedir(), ".easylopster", "node.json"));
}
export function defaultWorkspace() {
  return existsSync("/data") && process.platform === "linux" ? "/data/workspace" : path.join(os.homedir(), "easylopster");
}
export async function loadConfig(configPath: string): Promise<Partial<NodeConfig>> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Partial<NodeConfig>;
  } catch {
    return {};
  }
}
export async function saveConfig(configPath: string, c: NodeConfig) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(c, null, 2), { mode: 0o600 });
}

export function platform(): "windows" | "macos" | "linux" | "docker" {
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

export function exec(root: string, command: string, timeoutSec = 60, cwd?: string, extraEnv: Record<string, string> = {}) {
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

// ───────────────────────── background jobs ─────────────────────────
/**
 * Long work (downloads, builds, installs) must not die with the exec timeout: `exec` with
 * background=true starts a detached process whose output goes to <workspace>/jobs/<id>.log and
 * returns at once; `exec.jobs` lists, tails and kills them. Jobs live in memory, logs on disk.
 */
interface Job {
  id: string;
  pid: number;
  command: string;
  cwd: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  logPath: string;
  note?: string;
}
const jobs = new Map<string, Job>();
let jobsLoaded = false;

/** Jobs survive a node restart: the index is written to <workspace>/jobs/index.json and reloaded on first use. */
async function saveJobs(root: string) {
  const file = path.join(root, "jobs", "index.json");
  await mkdir(path.dirname(file), { recursive: true });
  const list = [...jobs.values()].slice(-200);
  await writeFile(file, JSON.stringify(list, null, 1), "utf8").catch(() => {});
}
function pidAlive(pid: number) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
async function loadJobs(root: string) {
  if (jobsLoaded) return;
  jobsLoaded = true;
  const text = await readFile(path.join(root, "jobs", "index.json"), "utf8").catch(() => null);
  if (!text) return;
  let list: Job[] = [];
  try {
    list = JSON.parse(text) as Job[];
  } catch {
    return;
  }
  const now = Date.now();
  for (const j of list) {
    if (!j?.id || jobs.has(j.id)) continue;
    if (j.endedAt == null && !pidAlive(j.pid)) {
      // Finished (or was killed) while the node app was not running; the exit code is unknown.
      j.endedAt = now;
      j.exitCode = null;
      j.note = "ended while the node app was offline; exit code unknown, see the log";
    } else if (j.endedAt == null) {
      j.note = "started before the node app restarted; still running";
    }
    jobs.set(j.id, j);
  }
  await saveJobs(root);
}

async function execBackground(root: string, command: string, cwd?: string, extraEnv: Record<string, string> = {}) {
  await loadJobs(root);
  const dir = cwd ? jail(root, cwd) : root;
  const jobsDir = path.join(root, "jobs");
  await mkdir(jobsDir, { recursive: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const logPath = path.join(jobsDir, `${id}.log`);
  const { openSync, closeSync } = await import("node:fs");
  const fd = openSync(logPath, "a");
  const isWin = process.platform === "win32";
  const env = { ...process.env, ...extraEnv };
  const child = isWin
    // Windows PowerShell refuses to run without a console, so a DETACHED_PROCESS spawn produces no output at all.
    // A plain hidden child is enough here: nothing kills it on a timeout, and Windows does not reap children with their parent.
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: dir, windowsHide: true, env, stdio: ["ignore", fd, fd] })
    : spawn("bash", ["-lc", command], { cwd: dir, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const job: Job = { id, pid: child.pid ?? -1, command, cwd: dir, startedAt: Date.now(), logPath };
  jobs.set(id, job);
  child.on("exit", (code) => {
    job.endedAt = Date.now();
    job.exitCode = code;
    void saveJobs(root);
  });
  child.on("error", () => {
    job.endedAt = Date.now();
    job.exitCode = -1;
    void saveJobs(root);
  });
  child.unref();
  await saveJobs(root);
  return { jobId: id, pid: job.pid, logPath: `jobs/${id}.log`, note: "Running in the background. Check with exec.jobs (status / tail); the log file is in the shared folder." };
}

async function jobsCmd(root: string, action: string, jobId?: string, lines = 60) {
  await loadJobs(root);
  // A job inherited from a previous run has no exit listener: notice when its process goes away.
  for (const j of jobs.values()) if (j.endedAt == null && j.note && !pidAlive(j.pid)) { j.endedAt = Date.now(); j.exitCode = null; j.note = "ended; exit code unknown (started before the node app restarted), see the log"; void saveJobs(root); }
  const view = (j: Job) => ({ jobId: j.id, pid: j.pid, command: j.command.slice(0, 200), startedAt: new Date(j.startedAt).toISOString(), running: j.endedAt == null, exitCode: j.exitCode ?? null, durationMs: (j.endedAt ?? Date.now()) - j.startedAt, logPath: path.relative(root, j.logPath).split(path.sep).join("/"), ...(j.note ? { note: j.note } : {}) });
  if (action === "list") return { jobs: [...jobs.values()].slice(-50).map(view) };
  if (!jobId) return { error: "jobId is required" };
  const j = jobs.get(jobId);
  if (!j) return { error: `Unknown job ${jobId}; the log file may still exist under jobs/.` };
  if (action === "status") return view(j);
  if (action === "tail") {
    const text = await readFile(j.logPath, "utf8").catch(() => "");
    const tail = text.split(/\r?\n/).slice(-Math.min(Math.max(lines, 1), 400)).join("\n");
    return { ...view(j), tail: tail.slice(-24_000) };
  }
  if (action === "kill") {
    if (j.endedAt != null) return { ...view(j), note: "already finished" };
    try {
      if (process.platform === "win32") await exec(os.tmpdir(), `taskkill /PID ${j.pid} /T /F`, 15);
      else process.kill(-j.pid, "SIGKILL");
    } catch (err) {
      return { error: (err as Error).message };
    }
    j.endedAt = Date.now();
    j.exitCode = -9;
    await saveJobs(root);
    return { ...view(j), killed: true };
  }
  return { error: `Unknown action ${action}` };
}

async function which(name: string) {
  if (!/^[\w.+-]+$/.test(name)) return { found: false, error: "invalid name" };
  const r = process.platform === "win32" ? await exec(os.tmpdir(), `(Get-Command ${name} -ErrorAction SilentlyContinue).Source`, 10) : await exec(os.tmpdir(), `command -v ${name}`, 10);
  const p = r.stdout.trim().split(/\r?\n/)[0] ?? "";
  return { found: !!p, path: p || undefined };
}

async function notify(title: string, body: string, log: (m: string) => void) {
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

export function deviceInfo(root: string) {
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

async function handle(root: string, method: NodeCapability, p: Record<string, unknown>, log: (m: string) => void): Promise<unknown> {
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
      if (p.background) return execBackground(root, String(p.command), p.cwd ? String(p.cwd) : undefined, p.env && typeof p.env === "object" ? (p.env as Record<string, string>) : {});
      return exec(root, String(p.command), p.timeoutSec ? Number(p.timeoutSec) : 60, p.cwd ? String(p.cwd) : undefined, p.env && typeof p.env === "object" ? (p.env as Record<string, string>) : {});
    case "exec.jobs":
      return jobsCmd(root, String(p.action ?? "list"), p.jobId ? String(p.jobId) : undefined, p.lines ? Number(p.lines) : 60);
    case "system.which":
      return which(String(p.name));
    case "system.notify":
      return notify(String(p.title ?? "easylopster"), String(p.body ?? ""), log);
    case "device.info":
      return deviceInfo(root);
    default:
      throw new Error(`Unsupported method ${method}`);
  }
}

// ───────────────────────── connection ─────────────────────────
export interface NodeAgent {
  start(): void;
  /** Closes the socket and stops reconnecting. */
  stop(): Promise<void>;
  readonly status: AgentStatus;
  readonly config: NodeConfig;
}

export function createNodeAgent(opts: AgentOptions): NodeAgent {
  const cfg = opts.config;
  const log = opts.log ?? ((m: string) => console.log(`[easylopster-node] ${new Date().toISOString()} ${m}`));
  const caps: NodeCapability[] = [...BASE_CAPS, ...(opts.extraCaps ?? [])];
  let status: AgentStatus = { state: "stopped", since: Date.now() };
  let ws: WebSocket | null = null;
  let running = false;
  let backoff = 1000;
  let timer: NodeJS.Timeout | null = null;
  let usePairing = !!opts.pairingCode && !cfg.token;

  const setStatus = (s: Partial<AgentStatus> & { state: AgentState }) => {
    status = { ...status, ...s, since: s.state === status.state ? status.since : Date.now() };
    opts.onStatus?.(status);
  };

  const connectOnce = async () => {
    if (!running) return;
    await mkdir(cfg.workspace, { recursive: true }).catch(() => {});
    log(`connecting to ${cfg.gateway} (${usePairing ? "pairing" : "token"})`);
    setStatus({ state: usePairing ? "pairing" : "connecting" });
    const sock = new WebSocket(cfg.gateway, { handshakeTimeout: 15_000 });
    ws = sock;
    const send = (f: NodeToGatewayFrame) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(f));

    sock.on("open", () => {
      send({
        type: "connect",
        v: PROTOCOL_VERSION,
        role: "node",
        auth: usePairing ? { kind: "pairing", code: opts.pairingCode! } : { kind: "token", token: cfg.token! },
        node: { name: cfg.name, platform: platform(), arch: os.arch(), agentVersion: VERSION, caps, workspaceRoot: cfg.workspace },
      });
    });

    sock.on("message", async (raw) => {
      let frame;
      try {
        frame = gatewayToNodeFrameSchema.parse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (frame.type === "connected") {
        backoff = 1000;
        if (frame.token) {
          cfg.token = frame.token;
          usePairing = false;
          await saveConfig(opts.configPath, cfg);
          log(`paired; token saved to ${opts.configPath}`);
        }
        log(`online as node ${frame.nodeId}; sharing ${cfg.workspace}`);
        setStatus({ state: "online", nodeId: frame.nodeId, lastError: undefined });
      } else if (frame.type === "ping") {
        send({ type: "pong", t: frame.t });
      } else if (frame.type === "req") {
        const started = Date.now();
        try {
          let payload: unknown;
          if (opts.extra && !BASE_CAPS.includes(frame.method)) payload = await opts.extra(frame.method, frame.params);
          else if (frame.method === "system.notify" && opts.notify) {
            await opts.notify(String(frame.params.title ?? "easylopster"), String(frame.params.body ?? ""));
            payload = { ok: true };
          } else payload = await handle(cfg.workspace, frame.method, frame.params, log);
          send({ type: "res", id: frame.id, ok: true, payload });
          log(`${frame.method} ok ${Date.now() - started}ms`);
        } catch (err) {
          send({ type: "res", id: frame.id, ok: false, error: { code: "failed", message: (err as Error).message } });
          log(`${frame.method} failed: ${(err as Error).message}`);
        }
      } else if (frame.type === "error") {
        log(`gateway error: ${frame.code} ${frame.message}`);
        if (frame.code === "auth_failed") {
          running = false;
          setStatus({ state: "auth_failed", lastError: frame.message });
        } else setStatus({ state: status.state, lastError: `${frame.code}: ${frame.message}` });
      }
    });

    sock.on("close", (code, reason) => {
      log(`disconnected (${code} ${reason.toString()})`);
      if (ws === sock) ws = null;
      if (!running) {
        if (status.state !== "auth_failed") setStatus({ state: "stopped" });
        return;
      }
      setStatus({ state: "offline" });
      timer = setTimeout(() => void connectOnce(), backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
    sock.on("error", (err) => {
      log(`socket error: ${err.message}`);
      setStatus({ state: status.state, lastError: err.message });
    });
  };

  return {
    get status() {
      return status;
    },
    get config() {
      return cfg;
    },
    start() {
      if (running) return;
      running = true;
      backoff = 1000;
      void connectOnce();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      const sock = ws;
      ws = null;
      if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
        await new Promise<void>((resolve) => {
          sock.once("close", () => resolve());
          sock.close(1000, "agent stopped");
          setTimeout(resolve, 2000);
        });
      }
      setStatus({ state: "stopped" });
    },
  };
}
