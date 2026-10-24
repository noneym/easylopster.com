import { contextBridge, ipcRenderer } from "electron";

const api = {
  getState: () => ipcRenderer.invoke("state:get"),
  pair: (code: string) => ipcRenderer.invoke("pair", code),
  unpair: () => ipcRenderer.invoke("unpair"),
  start: () => ipcRenderer.invoke("agent:start"),
  stop: () => ipcRenderer.invoke("agent:stop"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  setSettings: (patch: { name?: string; gateway?: string; autostart?: boolean; browser?: boolean }) => ipcRenderer.invoke("settings:set", patch),
  pickBrave: () => ipcRenderer.invoke("browser:pick"),
  closeBrowser: () => ipcRenderer.invoke("browser:close"),
  open: (what: "folder" | "dashboard" | "logs" | "config") => ipcRenderer.invoke("open", what),
  onState: (cb: (s: unknown) => void) => {
    ipcRenderer.on("state", (_e, s) => cb(s));
  },
  onLog: (cb: (line: string) => void) => {
    ipcRenderer.on("log", (_e, l) => cb(l));
  },
};

contextBridge.exposeInMainWorld("lopster", api);
export type LopsterApi = typeof api;
