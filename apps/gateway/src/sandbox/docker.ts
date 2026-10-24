import Docker from "dockerode";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { env } from "../env.ts";

/**
 * Cloud sandbox (Faz 3b): one short-lived container per bot, created on demand from a small image
 * we build on the host, with the bot's cloud workspace mounted at /workspace. Everything is
 * capability-dropped, memory/cpu/pid limited, and reaped after IDLE_MS without a command.
 */

export const SANDBOX_IMAGE = "easylopster-sandbox:1";
const IDLE_MS = 15 * 60_000;
const MEMORY_BYTES = 768 * 1024 * 1024;
const NANO_CPUS = 1_000_000_000; // 1 cpu
const PIDS_LIMIT = 256;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 300;
const MAX_OUTPUT = 24_000;

const SANDBOX_DOCKERFILE = `FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y --no-install-recommends \\
    bash coreutils curl ca-certificates git jq ripgrep unzip zip python3 python3-pip python3-venv nodejs npm sqlite3 procps \\
 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
CMD ["sleep", "infinity"]
`;

interface Live {
  id: string;
  lastUsed: number;
}

const log = (m: string) => console.log(`[sandbox] ${new Date().toISOString()} ${m}`);

let docker: Docker | null = null;
let imageReady: Promise<void> | null = null;
let hostWorkspaceRoot: Promise<string | null> | null = null;
const live = new Map<string, Live>();

export function sandboxAvailable(): boolean {
  return process.env.SANDBOX_ENABLED === "1";
}

function client(): Docker {
  if (!docker) docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
  return docker;
}

/** Builds the sandbox image once per gateway lifetime if it is missing on the host. */
async function ensureImage(): Promise<void> {
  if (!imageReady) {
    imageReady = (async () => {
      const d = client();
      try {
        await d.getImage(SANDBOX_IMAGE).inspect();
        return;
      } catch {}
      log(`building ${SANDBOX_IMAGE}`);
      const dir = await mkdtemp(path.join(os.tmpdir(), "el-sandbox-"));
      await writeFile(path.join(dir, "Dockerfile"), SANDBOX_DOCKERFILE);
      const stream = await d.buildImage({ context: dir, src: ["Dockerfile"] }, { t: SANDBOX_IMAGE });
      await new Promise<void>((resolve, reject) =>
        d.modem.followProgress(stream, (err: Error | null, res: { error?: string }[]) => {
          if (err) return reject(err);
          const bad = res?.find((r) => r.error);
          bad ? reject(new Error(bad.error)) : resolve();
        }),
      );
      log(`built ${SANDBOX_IMAGE}`);
    })().catch((err) => {
      imageReady = null;
      throw err;
    });
  }
  return imageReady;
}

/**
 * The gateway sees workspaces at WORKSPACE_ROOT inside its own container; sibling containers need
 * the host path of that mount. We read it from our own container's mounts (hostname = container id).
 * Outside Docker (local dev) WORKSPACE_ROOT itself is the host path.
 */
async function resolveHostWorkspaceRoot(): Promise<string | null> {
  if (!hostWorkspaceRoot) {
    hostWorkspaceRoot = (async () => {
      const root = path.resolve(env().WORKSPACE_ROOT);
      if (process.env.SANDBOX_HOST_WORKSPACE_ROOT) return process.env.SANDBOX_HOST_WORKSPACE_ROOT;
      try {
        const me = await client().getContainer(os.hostname()).inspect();
        const mount = me.Mounts.find((m) => m.Destination === root || root.startsWith(m.Destination + "/"));
        if (mount) {
          const rest = path.posix.relative(mount.Destination, root);
          return rest ? path.posix.join(mount.Source, rest) : mount.Source;
        }
        log(`no mount found for ${root} on own container; sandboxes get no workspace`);
        return null;
      } catch {
        return root; // not running in docker
      }
    })();
  }
  return hostWorkspaceRoot;
}

async function ensureContainer(userId: string, botId: string): Promise<Docker.Container> {
  const d = client();
  const key = botId;
  const existing = live.get(key);
  if (existing) {
    try {
      const c = d.getContainer(existing.id);
      const info = await c.inspect();
      if (info.State.Running) {
        existing.lastUsed = Date.now();
        return c;
      }
    } catch {}
    live.delete(key);
  }
  await ensureImage();
  const hostRoot = await resolveHostWorkspaceRoot();
  const binds = hostRoot ? [`${path.posix.join(hostRoot.replace(/\\/g, "/"), userId, botId)}:/workspace`] : [];
  const c = await d.createContainer({
    Image: SANDBOX_IMAGE,
    name: `el-sandbox-${botId}-${Date.now().toString(36)}`,
    Cmd: ["sleep", "infinity"],
    WorkingDir: "/workspace",
    Env: ["HOME=/workspace/.home", "TERM=dumb"],
    Labels: { "easylopster.sandbox": "1", "easylopster.bot": botId, "easylopster.user": userId },
    HostConfig: {
      Binds: binds,
      Memory: MEMORY_BYTES,
      MemorySwap: MEMORY_BYTES,
      NanoCpus: NANO_CPUS,
      PidsLimit: PIDS_LIMIT,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      NetworkMode: "bridge",
      AutoRemove: true,
      ReadonlyRootfs: false,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
    },
  });
  await c.start();
  live.set(key, { id: c.id, lastUsed: Date.now() });
  log(`started container for bot=${botId}${binds.length ? "" : " (no workspace mount)"}`);
  return c;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export async function sandboxExec(userId: string, botId: string, command: string, opts: { timeoutSec?: number; cwd?: string } = {}): Promise<ExecResult> {
  const timeoutSec = Math.min(Math.max(opts.timeoutSec ?? DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S);
  const c = await ensureContainer(userId, botId);
  const started = Date.now();
  const exec = await c.exec({
    Cmd: ["timeout", "-k", "5", String(timeoutSec), "bash", "-lc", command],
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: opts.cwd ? path.posix.join("/workspace", opts.cwd.replace(/^\/+/, "")) : "/workspace",
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  const err = new PassThrough();
  let stdout = "";
  let stderr = "";
  out.on("data", (b: Buffer) => (stdout.length < MAX_OUTPUT ? (stdout += b.toString("utf8")) : null));
  err.on("data", (b: Buffer) => (stderr.length < MAX_OUTPUT ? (stderr += b.toString("utf8")) : null));
  client().modem.demuxStream(stream, out, err);
  await new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
    stream.on("error", () => resolve());
  });
  const info = await exec.inspect();
  const exitCode = info.ExitCode ?? -1;
  const l = live.get(botId);
  if (l) l.lastUsed = Date.now();
  return {
    exitCode,
    stdout: stdout.length >= MAX_OUTPUT ? stdout.slice(0, MAX_OUTPUT) + "\n[...output truncated]" : stdout,
    stderr: stderr.length >= MAX_OUTPUT ? stderr.slice(0, MAX_OUTPUT) + "\n[...output truncated]" : stderr,
    timedOut: exitCode === 124 || exitCode === 137,
    durationMs: Date.now() - started,
  };
}

/** Stops idle sandboxes and, at boot, any leftovers from a previous gateway process. */
export function startSandboxReaper(): () => void {
  const sweep = async () => {
    const d = client();
    const now = Date.now();
    for (const [botId, l] of live) {
      if (now - l.lastUsed > IDLE_MS) {
        live.delete(botId);
        await d.getContainer(l.id).stop({ t: 2 }).catch(() => {});
        log(`stopped idle container for bot=${botId}`);
      }
    }
  };
  const boot = async () => {
    try {
      const list = await client().listContainers({ all: true, filters: { label: ["easylopster.sandbox=1"] } });
      for (const c of list) {
        if (!live.has(c.Labels["easylopster.bot"] ?? "")) await client().getContainer(c.Id).remove({ force: true }).catch(() => {});
      }
    } catch (err) {
      log(`docker not reachable: ${(err as Error).message}`);
    }
  };
  void boot();
  const t = setInterval(() => void sweep(), 60_000);
  return () => {
    clearInterval(t);
    for (const l of live.values()) void client().getContainer(l.id).stop({ t: 2 }).catch(() => {});
  };
}
