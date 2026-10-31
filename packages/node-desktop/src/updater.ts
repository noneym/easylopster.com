/**
 * Auto-update for the packaged Windows app: checks GitHub releases (latest.yml published next to
 * the NSIS installer), downloads in the background and installs when the app quits, or at once
 * when the user picks "Restart to update" in the tray. Dev runs (`electron .`) never update.
 */
import { app, Notification, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

/** macOS builds are not signed with an Apple Developer ID, and Squirrel.Mac only installs signed
 * updates; there the updater checks and tells the user, and "Download" opens the release page. */
export const MANUAL_UPDATES = process.platform === "darwin";
const RELEASES_URL = "https://github.com/noneym/easylopster.com/releases/latest";

export interface UpdateState {
  manual?: boolean;
  checking: boolean;
  available?: string;
  downloaded?: string;
  progress?: number;
  error?: string;
  lastCheck?: number;
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const state: UpdateState = { checking: false, manual: MANUAL_UPDATES };
let timer: NodeJS.Timeout | null = null;

export function updateState(): UpdateState {
  return { ...state };
}

export function setupUpdater(log: (l: string) => void, onChange: () => void) {
  if (!app.isPackaged) {
    log("updater: dev run, auto-update disabled");
    return;
  }
  autoUpdater.logger = null;
  autoUpdater.autoDownload = !MANUAL_UPDATES;
  autoUpdater.autoInstallOnAppQuit = !MANUAL_UPDATES;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    state.checking = true;
    state.error = undefined;
    onChange();
  });
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    state.checking = false;
    state.available = info.version;
    state.lastCheck = Date.now();
    if (MANUAL_UPDATES) {
      log(`updater: version ${info.version} is available; download it from the releases page`);
      try {
        const n = new Notification({ title: "easylopster Node update available", body: `Version ${info.version} is out. Click to download it.` });
        n.on("click", () => void shell.openExternal(RELEASES_URL));
        n.show();
      } catch {}
    } else log(`updater: update ${info.version} available, downloading`);
    onChange();
  });
  autoUpdater.on("update-not-available", () => {
    state.checking = false;
    state.available = undefined;
    state.lastCheck = Date.now();
    onChange();
  });
  autoUpdater.on("download-progress", (p) => {
    state.progress = Math.round(p.percent);
    onChange();
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    state.checking = false;
    state.downloaded = info.version;
    state.progress = 100;
    log(`updater: ${info.version} downloaded; it installs when the app restarts (tray → Restart to update)`);
    try {
      new Notification({ title: "easylopster Node update ready", body: `Version ${info.version} installs the next time the app restarts. Use the tray menu to restart now.` }).show();
    } catch {}
    onChange();
  });
  autoUpdater.on("error", (err) => {
    state.checking = false;
    state.error = err?.message ?? String(err);
    state.lastCheck = Date.now();
    log(`updater: ${state.error}`);
    onChange();
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 30_000);
  timer = setInterval(check, CHECK_EVERY_MS);
  timer.unref();
}

export function checkForUpdatesNow() {
  if (!app.isPackaged) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

/** Quits and installs the downloaded update; the app relaunches by itself. */
export function openDownloadPage() {
  void shell.openExternal(RELEASES_URL);
}

export function installUpdateNow() {
  if (MANUAL_UPDATES) return openDownloadPage();
  if (!state.downloaded) return;
  autoUpdater.quitAndInstall(true, true);
}
