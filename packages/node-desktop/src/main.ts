/**
 * easylopster Node for Windows: tray application around the node agent library.
 * Runs the agent in-process, shows status in the tray, offers pairing, folder choice,
 * autostart and (opt-in) browser control of Brave. The node config file is shared with the
 * CLI (~/.easylopster/node.json).
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, Notification, clipboard } from "electron";
import os from "node:os";
import path from "node:path";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_GATEWAY, VERSION, createNodeAgent, defaultConfigPath, defaultWorkspace, loadConfig, saveConfig, type AgentStatus, type NodeAgent, type NodeConfig } from "easylopster-node/agent";
import { BROWSER_CAPS } from "@easylopster/shared/node-protocol";
import { BrowserController, findBrave } from "./browser";

const DASHBOARD_URL = "https://easylopster.com/dashboard/nodes";
const isHidden = process.argv.includes("--hidden");

interface DesktopSettings {
  autostart: boolean;
  /** Declare browser.* capabilities and let bots drive Brave (dedicated profile). */
  browser: boolean;
  /** brave.exe chosen by the user when auto-detection fails. */
  bravePath?: string;
}

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let agent: NodeAgent | null = null;
let quitting = false;
let config: NodeConfig;
let settings: DesktopSettings = { autostart: false, browser: false };
/** One controller per Brave profile; "default" is the original brave-profile folder, others live under brave-profiles/<name>. */
const browsers = new Map<string, BrowserController>();
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
let status: AgentStatus = { state: "stopped", since: Date.now() };
const logs: string[] = [];
// Dev runs (`electron .`) must never touch the installed app's config (~/.easylopster/node.json):
// they get their own file unless EASYLOPSTER_CONFIG says otherwise.
// Dev runs keep their own data folder (settings, logs, Brave profile) and their own single-instance lock,
// so `electron .` can run next to the installed app without stealing its lock or settings.
if (!app.isPackaged && !process.env.EASYLOPSTER_USERDATA_SHARED) app.setPath("userData", `${app.getPath("userData")}-dev`);

const configPath = process.env.EASYLOPSTER_CONFIG ?? (app.isPackaged ? defaultConfigPath() : path.join(app.getPath("userData"), "node.dev.json"));
const settingsPath = () => path.join(app.getPath("userData"), "desktop.json");
const logPath = () => path.join(app.getPath("userData"), "node.log");

// ───────────────────────── logging ─────────────────────────
function log(line: string) {
  const entry = `${new Date().toISOString()} ${line}`;
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  win?.webContents.send("log", entry);
  appendFile(logPath(), entry + "\n").catch(() => {});
}

// ───────────────────────── state ─────────────────────────
function publicState() {
  return {
    version: VERSION,
    paired: !!config.token,
    config: { gateway: config.gateway, workspace: config.workspace, name: config.name },
    status,
    settings,
    configPath,
    logs,
    hostname: os.hostname(),
    bravePath: findBrave(settings.bravePath) ?? null,
    browserRunning: anyBrowserRunning(),
  };
}
function pushState() {
  win?.webContents.send("state", publicState());
  updateTray();
}

async function loadSettings() {
  try {
    settings = { ...settings, ...(JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<DesktopSettings>) };
  } catch {}
}
async function persistSettings() {
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

function applyAutostart() {
  if (!app.isPackaged) return; // `electron .` in dev would register the electron binary
  app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ["--hidden"] });
}

// ───────────────────────── browser ─────────────────────────
function profileDir(name: string) {
  return name === "default" ? path.join(app.getPath("userData"), "brave-profile") : path.join(app.getPath("userData"), "brave-profiles", name);
}
function normalizeProfile(raw: unknown) {
  const name = String(raw ?? "default").trim() || "default";
  if (!PROFILE_RE.test(name)) throw new Error(`Invalid profile name "${name}" (letters, digits, - and _, max 32).`);
  return name;
}
function getBrowser(profile = "default") {
  let b = browsers.get(profile);
  if (!b) {
    b = new BrowserController({
      profileDir: profileDir(profile),
      workspace: () => config.workspace,
      bravePath: () => settings.bravePath,
      log: (line) => log(profile === "default" ? line : line.replace(/^browser:/, `browser[${profile}]:`)),
    });
    browsers.set(profile, b);
  }
  return b;
}
function anyBrowserRunning() {
  for (const b of browsers.values()) if (b.running) return true;
  return false;
}
async function closeBrowser(profile?: string) {
  const list = profile ? [profile] : [...browsers.keys()];
  await Promise.all(
    list.map(async (name) => {
      const b = browsers.get(name);
      browsers.delete(name);
      if (b) await b.close().catch(() => {});
    }),
  );
  pushState();
}
/** browser.profiles: list / create / close / delete named Brave profiles (separate cookies and logins per profile). */
async function profilesCmd(action: string, p: Record<string, unknown>) {
  const { readdir, rm, mkdir } = await import("node:fs/promises");
  const root = path.join(app.getPath("userData"), "brave-profiles");
  await mkdir(root, { recursive: true });
  const names = ["default", ...(await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()];
  if (action === "list") return { profiles: names.map((n) => ({ name: n, running: !!browsers.get(n)?.running })), note: "Pass profile=<name> to any browser tool to use that profile; each has its own cookies and logins." };
  const name = normalizeProfile(p.name);
  if (action === "create") {
    if (names.includes(name)) return { profile: name, created: false, note: "already exists" };
    await mkdir(profileDir(name), { recursive: true });
    log(`browser: profile ${name} created`);
    return { profile: name, created: true };
  }
  if (action === "close") {
    await closeBrowser(name);
    return { profile: name, closed: true };
  }
  if (action === "delete") {
    if (name === "default") throw new Error("The default profile cannot be deleted; use browser.cookies clear instead.");
    await closeBrowser(name);
    await rm(profileDir(name), { recursive: true, force: true });
    log(`browser: profile ${name} deleted`);
    return { profile: name, deleted: true };
  }
  throw new Error(`Unknown profiles action ${action}`);
}
/** system.clipboard: read or write the clipboard text of this PC. */
async function clipboardCmd(action: string, p: Record<string, unknown>) {
  if (action === "write") {
    const text = String(p.text ?? "");
    await clipboard.writeText(text);
    return { written: text.length };
  }
  const text = await clipboard.readText();
  const max = Math.min(Math.max(Number(p.maxChars ?? 20_000), 100), 200_000);
  return { text: text.slice(0, max), length: text.length, truncated: text.length > max };
}

// ───────────────────────── agent ─────────────────────────
function buildAgent(pairingCode?: string) {
  return createNodeAgent({
    config,
    configPath,
    pairingCode,
    log,
    extraCaps: ["system.clipboard", ...(settings.browser ? BROWSER_CAPS : [])],
    extra: async (method, params) => {
      if (method === "system.clipboard") return clipboardCmd(String(params.action ?? "read"), params);
      if (!settings.browser) throw new Error("Browser control is turned off on this node.");
      if (method === "browser.profiles") {
        const r = await profilesCmd(String(params.action ?? "list"), params);
        pushState();
        return r;
      }
      const r = await getBrowser(normalizeProfile(params.profile)).handle(method, params);
      pushState();
      return r;
    },
    onStatus: (s) => {
      const was = status.state;
      status = s;
      pushState();
      if (s.state === "online" && was !== "online") notify("Connected", `${config.name} is online. Sharing ${config.workspace}`);
      if (s.state === "auth_failed") notify("Pairing failed", s.lastError ?? "Get a new pairing code from the dashboard.");
    },
    notify: async (title, body) => notify(title, body),
  });
}

async function startAgent(pairingCode?: string) {
  if (agent) await agent.stop();
  agent = buildAgent(pairingCode);
  agent.start();
}
async function stopAgent() {
  if (agent) await agent.stop();
  agent = null;
  status = { state: "stopped", since: Date.now() };
  pushState();
}

function notify(title: string, body: string) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: path.join(__dirname, "icon.png") }).show();
}

// ───────────────────────── tray ─────────────────────────
const STATE_LABEL: Record<AgentStatus["state"], string> = {
  stopped: "Stopped",
  connecting: "Connecting…",
  pairing: "Pairing…",
  online: "Online",
  offline: "Reconnecting…",
  auth_failed: "Pairing failed",
};

function trayIcon(on: boolean) {
  return nativeImage.createFromPath(path.join(__dirname, on ? "tray.png" : "tray-off.png"));
}

function updateTray() {
  if (!tray) return;
  const online = status.state === "online";
  tray.setImage(trayIcon(online));
  tray.setToolTip(`easylopster Node — ${STATE_LABEL[status.state]}${online ? ` (${config.name})` : ""}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${STATE_LABEL[status.state]}${config.token ? ` · ${config.name}` : " · not paired"}`, enabled: false },
      { type: "separator" },
      { label: "Open easylopster Node", click: showWindow },
      { label: "Open shared folder", click: () => void shell.openPath(config.workspace) },
      { label: "Open dashboard", click: () => void shell.openExternal(DASHBOARD_URL) },
      { type: "separator" },
      config.token && status.state !== "stopped" ? { label: "Disconnect", click: () => void stopAgent() } : { label: "Connect", enabled: !!config.token, click: () => void startAgent() },
      { label: "Start with Windows", type: "checkbox", checked: settings.autostart, click: (item) => void setAutostart(item.checked) },
      { label: "Browser control (Brave)", type: "checkbox", checked: settings.browser, click: (item) => void setBrowser(item.checked) },
      ...(anyBrowserRunning() ? [{ label: "Close controlled Brave", click: () => void closeBrowser() }] : []),
      { type: "separator" },
      { label: "Quit", click: () => quit() },
    ]),
  );
}

async function setAutostart(on: boolean) {
  settings.autostart = on;
  await persistSettings();
  applyAutostart();
  pushState();
}

/** Toggling browser control changes the declared capabilities, so the agent reconnects. */
async function setBrowser(on: boolean) {
  if (on === settings.browser) return;
  settings.browser = on;
  await persistSettings();
  log(`browser control ${on ? "enabled" : "disabled"}${on ? ` (${findBrave(settings.bravePath) ?? "brave.exe not found"})` : ""}`);
  if (!on) await closeBrowser();
  if (agent && status.state !== "stopped") await startAgent();
  pushState();
}

// ───────────────────────── window ─────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 400,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: "easylopster Node",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#111111",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}
function showWindow() {
  if (!win) createWindow();
  win!.show();
  win!.focus();
}
function quit() {
  quitting = true;
  void Promise.all([agent ? agent.stop() : Promise.resolve(), closeBrowser()]).then(() => app.quit());
}

// ───────────────────────── ipc ─────────────────────────
ipcMain.handle("state:get", () => publicState());
ipcMain.handle("pair", async (_e, code: string) => {
  const c = String(code ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (c.length < 4) throw new Error("Enter the pairing code from the dashboard.");
  config.token = undefined;
  await saveConfig(configPath, config);
  await startAgent(c);
  return publicState();
});
ipcMain.handle("unpair", async () => {
  await stopAgent();
  config.token = undefined;
  await saveConfig(configPath, config);
  pushState();
  return publicState();
});
ipcMain.handle("agent:start", async () => {
  if (config.token) await startAgent();
  return publicState();
});
ipcMain.handle("agent:stop", async () => {
  await stopAgent();
  return publicState();
});
ipcMain.handle("workspace:choose", async () => {
  const r = await dialog.showOpenDialog(win!, { title: "Choose the folder to share with your agent", defaultPath: config.workspace, properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return publicState();
  config.workspace = r.filePaths[0];
  await saveConfig(configPath, config);
  log(`shared folder set to ${config.workspace}`);
  if (agent && status.state !== "stopped") await startAgent();
  pushState();
  return publicState();
});
ipcMain.handle("browser:pick", async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: "Locate brave.exe",
    defaultPath: findBrave(settings.bravePath),
    properties: ["openFile"],
    filters: [{ name: "Brave", extensions: ["exe"] }],
  });
  if (r.canceled || !r.filePaths[0]) return publicState();
  settings.bravePath = r.filePaths[0];
  await persistSettings();
  log(`brave path set to ${settings.bravePath}`);
  await closeBrowser();
  pushState();
  return publicState();
});
ipcMain.handle("browser:close", async () => {
  await closeBrowser();
  return publicState();
});
ipcMain.handle("settings:set", async (_e, patch: { name?: string; gateway?: string; autostart?: boolean; browser?: boolean }) => {
  let restart = false;
  if (typeof patch.name === "string" && patch.name.trim() && patch.name.trim() !== config.name) {
    config.name = patch.name.trim().slice(0, 80);
    restart = true;
  }
  if (typeof patch.gateway === "string" && /^wss?:\/\//.test(patch.gateway.trim()) && patch.gateway.trim() !== config.gateway) {
    config.gateway = patch.gateway.trim();
    restart = true;
  }
  await saveConfig(configPath, config);
  if (typeof patch.autostart === "boolean") await setAutostart(patch.autostart);
  if (typeof patch.browser === "boolean" && patch.browser !== settings.browser) {
    await setBrowser(patch.browser);
    restart = false; // setBrowser already reconnected
  }
  if (restart && agent && status.state !== "stopped") await startAgent();
  pushState();
  return publicState();
});
ipcMain.handle("open", async (_e, what: "folder" | "dashboard" | "logs" | "config") => {
  if (what === "folder") await shell.openPath(config.workspace);
  else if (what === "dashboard") await shell.openExternal(DASHBOARD_URL);
  else if (what === "logs") await shell.openPath(logPath());
  else if (what === "config") shell.showItemInFolder(configPath);
});

// ───────────────────────── lifecycle ─────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.setAppUserModelId("com.easylopster.node");

  app.whenReady().then(async () => {
    const saved = await loadConfig(configPath);
    config = {
      gateway: saved.gateway ?? DEFAULT_GATEWAY,
      token: saved.token,
      workspace: path.resolve(saved.workspace ?? defaultWorkspace()),
      name: saved.name ?? os.hostname(),
    };
    await loadSettings();
    applyAutostart();

    tray = new Tray(trayIcon(false));
    tray.on("click", showWindow);
    tray.on("double-click", showWindow);
    updateTray();

    createWindow();
    if (!isHidden || !config.token) showWindow();

    log(`easylopster Node ${VERSION} started (config ${configPath})`);
    if (config.token) await startAgent();
  });

  app.on("window-all-closed", () => {
    /* keep running in the tray */
  });
  app.on("before-quit", () => {
    quitting = true;
  });
}
