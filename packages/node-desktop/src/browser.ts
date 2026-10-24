/**
 * Browser control for the Windows node: drives Brave through the Chrome DevTools Protocol.
 *
 * Brave is launched on demand with `--remote-debugging-port=<free port>` and a dedicated
 * `--user-data-dir` under the app's userData, so the user's own profile, cookies and sessions
 * are never touched. One WebSocket to the browser endpoint is multiplexed over all tabs with
 * flattened `Target.attachToTarget` sessions. Served capabilities: browser.open, browser.snapshot,
 * browser.click, browser.type, browser.screenshot, browser.tabs.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";

const SNAPSHOT_LIMIT = 20_000;
const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 600;

export interface BrowserOptions {
  /** Directory for the dedicated Brave profile (created on first launch). */
  profileDir: string;
  /** Node workspace: screenshots are written to <workspace>/inbox/. */
  workspace: () => string;
  /** Explicit brave.exe path chosen by the user, if any. */
  bravePath: () => string | undefined;
  log: (line: string) => void;
}

export function findBrave(explicit?: string): string | undefined {
  const candidates = [
    explicit,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function getJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}
interface TabState {
  tabId: string;
  targetId: string;
  sessionId?: string;
  loading: boolean;
}

/** Script run inside the page: a compact, ref-annotated text snapshot (OpenClaw/agent-browser style). */
const SNAPSHOT_SCRIPT = `(() => {
  const LIMIT = ${SNAPSHOT_LIMIT};
  const INTERACTIVE = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=textbox],[contenteditable=true],[onclick]";
  const SKIP = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","SVG","PATH","HEAD","META","LINK"]);
  const BLOCK = new Set(["P","DIV","SECTION","ARTICLE","LI","TR","H1","H2","H3","H4","H5","H6","HEADER","FOOTER","NAV","MAIN","ASIDE","BLOCKQUOTE","PRE","TD","TH","DT","DD","FORM","LABEL","FIGCAPTION","UL","OL","TABLE"]);
  let n = 0;
  const seen = new WeakSet();
  const lines = [];
  let cur = "";
  const flush = () => { const t = cur.replace(/\\s+/g, " ").trim(); if (t) lines.push(t); cur = ""; };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el) => {
    const a = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("name");
    if (a) return a;
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent || ""; }
    const lab = el.closest("label"); if (lab) return lab.textContent || "";
    return (el.innerText || el.textContent || el.value || "");
  };
  const role = (el) => {
    const tag = el.tagName.toLowerCase();
    const r = el.getAttribute("role"); if (r) return r;
    if (tag === "a") return "link";
    if (tag === "input") { const t = (el.getAttribute("type") || "text").toLowerCase(); return t === "submit" || t === "button" ? "button" : t === "checkbox" || t === "radio" ? t : "input:" + t; }
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "button" || tag === "summary") return "button";
    if (el.isContentEditable) return "textbox";
    return "clickable";
  };
  const walk = (node) => {
    if (lines.join("\\n").length > LIMIT) return;
    if (node.nodeType === 3) { cur += " " + node.nodeValue; return; }
    if (node.nodeType !== 1) return;
    const el = node;
    if (SKIP.has(el.tagName) || seen.has(el)) return;
    if (el.tagName === "IFRAME") { flush(); lines.push("[iframe " + (el.src || "") + "]"); return; }
    if (!visible(el)) return;
    if (el.matches(INTERACTIVE)) {
      seen.add(el);
      flush();
      const id = "e" + (++n);
      el.setAttribute("data-lopster-ref", id);
      const r = role(el);
      let txt = label(el).replace(/\\s+/g, " ").trim().slice(0, 120);
      let extra = "";
      if (el.tagName === "A" && el.getAttribute("href")) extra = " -> " + el.href.slice(0, 160);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { if (el.value) extra += ' value="' + String(el.value).slice(0, 80) + '"'; if (el.checked) extra += " checked"; }
      if (el.tagName === "SELECT") { const o = el.options[el.selectedIndex]; if (o) extra += ' selected="' + o.text.slice(0, 60) + '"'; }
      if (el.disabled) extra += " disabled";
      lines.push("[" + id + "] " + r + ' "' + txt + '"' + extra);
      return;
    }
    const tag = el.tagName;
    const block = BLOCK.has(tag);
    if (block) flush();
    if (/^H[1-6]$/.test(tag)) cur += "\\n" + "#".repeat(+tag[1]) + " ";
    if (tag === "LI") cur += "- ";
    if (tag === "IMG") { const a = el.getAttribute("alt"); if (a) cur += " [img: " + a.slice(0, 80) + "]"; return; }
    for (const c of el.childNodes) walk(c);
    if (block) flush();
  };
  walk(document.body || document.documentElement);
  flush();
  let out = lines.join("\\n");
  const truncated = out.length > LIMIT;
  if (truncated) out = out.slice(0, LIMIT) + "\\n[...truncated; scroll or follow a link for more]";
  return { title: document.title, url: location.href, snapshot: out, refs: n, truncated, scrollY: Math.round(scrollY), pageHeight: Math.round(document.documentElement.scrollHeight), viewportHeight: innerHeight };
})()`;

/** Locates an element by ref or CSS selector, scrolls it into view and returns its centre. */
const LOCATE_SCRIPT = (target: string) => `(() => {
  const t = ${JSON.stringify(target)};
  let el = document.querySelector('[data-lopster-ref="' + t + '"]');
  if (!el) { try { el = document.querySelector(t); } catch {} }
  if (!el) return { error: "No element for " + t + ". Take a new snapshot; refs change after navigation." };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return { error: "Element " + t + " is not visible." };
  return { x: r.left + Math.min(r.width / 2, 200), y: r.top + Math.min(r.height / 2, 100), tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || "").slice(0, 80) };
})()`;

export class BrowserController {
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private port = 0;
  private nextMsg = 1;
  private pending = new Map<number, Pending>();
  private tabs = new Map<string, TabState>(); // tabId -> state
  private byTarget = new Map<string, TabState>();
  private bySession = new Map<string, TabState>();
  private tabSeq = 0;
  private starting: Promise<void> | null = null;

  constructor(private readonly opts: BrowserOptions) {}

  get running() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Routes a browser.* request from the gateway. */
  async handle(method: string, p: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "browser.open":
        return this.open(String(p.url ?? ""), p.tabId ? String(p.tabId) : undefined);
      case "browser.snapshot":
        return this.snapshot(p.tabId ? String(p.tabId) : undefined, p.scrollTo != null ? Number(p.scrollTo) : undefined);
      case "browser.click":
        return this.click(String(p.target ?? p.ref ?? p.selector ?? ""), p.tabId ? String(p.tabId) : undefined);
      case "browser.type":
        return this.type(String(p.target ?? p.ref ?? p.selector ?? ""), String(p.text ?? ""), { enter: !!p.enter, clear: p.clear !== false }, p.tabId ? String(p.tabId) : undefined);
      case "browser.screenshot":
        return this.screenshot(p.tabId ? String(p.tabId) : undefined, !!p.fullPage);
      case "browser.tabs":
        return this.tabsCmd(String(p.action ?? "list"), p.tabId ? String(p.tabId) : undefined);
      default:
        throw new Error(`Unsupported method ${method}`);
    }
  }

  // ───────────────────────── lifecycle ─────────────────────────
  async ensure(): Promise<void> {
    if (this.running) return;
    if (!this.starting) this.starting = this.launch().finally(() => (this.starting = null));
    return this.starting;
  }

  private async launch() {
    const exe = findBrave(this.opts.bravePath());
    if (!exe) throw new Error("Brave is not installed (or not found). Pick brave.exe in easylopster Node → Settings → Browser.");
    await mkdir(this.opts.profileDir, { recursive: true });
    this.port = await freePort();
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.opts.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-features=Translate",
      "--window-size=1280,900",
      "about:blank",
    ];
    this.opts.log(`browser: launching ${exe} (port ${this.port}, profile ${this.opts.profileDir})`);
    const child = spawn(exe, args, { detached: false, stdio: "ignore", windowsHide: false });
    this.child = child;
    child.on("exit", (code) => {
      this.opts.log(`browser: Brave exited (${code ?? "signal"})`);
      if (this.child === child) this.teardown();
    });

    let endpoint: string | undefined;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !endpoint) {
      try {
        const v = await getJson<{ webSocketDebuggerUrl?: string }>(`http://127.0.0.1:${this.port}/json/version`);
        endpoint = v.webSocketDebuggerUrl;
      } catch {
        await sleep(250);
      }
    }
    if (!endpoint) {
      child.kill();
      throw new Error("Brave started but the DevTools endpoint did not come up within 20s.");
    }
    await new Promise<void>((resolve, reject) => {
      const sock = new WebSocket(endpoint!, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      sock.on("open", () => {
        this.ws = sock;
        resolve();
      });
      sock.on("error", (err) => reject(err));
      sock.on("message", (raw) => this.onMessage(raw.toString()));
      sock.on("close", () => {
        if (this.ws === sock) this.teardown();
      });
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
    await this.refreshTargets();
    this.opts.log("browser: connected to Brave DevTools");
  }

  async close() {
    const child = this.child;
    this.teardown();
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
  }

  private teardown() {
    for (const p of this.pending.values()) p.reject(new Error("browser disconnected"));
    this.pending.clear();
    this.tabs.clear();
    this.byTarget.clear();
    this.bySession.clear();
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.child = null;
  }

  // ───────────────────────── cdp plumbing ─────────────────────────
  private send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("browser is not running"));
    const id = this.nextMsg++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  private onMessage(text: string) {
    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    const ev = msg.method;
    const params = msg.params ?? {};
    if (ev === "Target.targetCreated" || ev === "Target.targetInfoChanged") {
      const info = params.targetInfo as { targetId: string; type: string; url: string };
      if (info.type === "page" && !this.byTarget.has(info.targetId)) this.register(info.targetId);
    } else if (ev === "Target.targetDestroyed") {
      const t = this.byTarget.get(String(params.targetId));
      if (t) this.forget(t);
    } else if (ev === "Target.detachedFromTarget") {
      const t = this.bySession.get(String(params.sessionId));
      if (t) {
        this.bySession.delete(t.sessionId!);
        t.sessionId = undefined;
      }
    } else if (msg.sessionId) {
      const t = this.bySession.get(msg.sessionId);
      if (!t) return;
      if (ev === "Page.frameStartedLoading" && params.frameId && !t.loading) t.loading = true;
      if (ev === "Page.loadEventFired" || ev === "Page.frameStoppedLoading") t.loading = false;
    }
  }

  private register(targetId: string): TabState {
    const t: TabState = { tabId: `tab${++this.tabSeq}`, targetId, loading: false };
    this.tabs.set(t.tabId, t);
    this.byTarget.set(targetId, t);
    return t;
  }
  private forget(t: TabState) {
    this.tabs.delete(t.tabId);
    this.byTarget.delete(t.targetId);
    if (t.sessionId) this.bySession.delete(t.sessionId);
  }

  private async refreshTargets() {
    const { targetInfos } = await this.send<{ targetInfos: { targetId: string; type: string; url: string; title: string }[] }>("Target.getTargets");
    const pages = targetInfos.filter((t) => t.type === "page");
    for (const p of pages) if (!this.byTarget.has(p.targetId)) this.register(p.targetId);
    for (const t of [...this.tabs.values()]) if (!pages.some((p) => p.targetId === t.targetId)) this.forget(t);
    return pages;
  }

  /** Attaches (once) to a tab and returns its CDP session. */
  private async session(t: TabState): Promise<string> {
    if (t.sessionId && this.bySession.has(t.sessionId)) return t.sessionId;
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    t.sessionId = sessionId;
    this.bySession.set(sessionId, t);
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    return sessionId;
  }

  private async tab(tabId?: string): Promise<TabState> {
    await this.ensure();
    if (tabId) {
      const t = this.tabs.get(tabId);
      if (!t) throw new Error(`Unknown tab ${tabId}. Call browser.tabs to list open tabs.`);
      return t;
    }
    if (this.tabs.size === 0) await this.refreshTargets();
    const last = [...this.tabs.values()].at(-1);
    if (last) return last;
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    return this.byTarget.get(targetId) ?? this.register(targetId);
  }

  private async waitForLoad(t: TabState, timeoutMs = LOAD_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    await sleep(150);
    while (t.loading && Date.now() < deadline) await sleep(100);
    await sleep(SETTLE_MS);
  }

  private async evaluate<T>(sessionId: string, expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T; description?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  private async pageInfo(sessionId: string) {
    return this.evaluate<{ url: string; title: string }>(sessionId, "({ url: location.href, title: document.title })");
  }

  // ───────────────────────── commands ─────────────────────────
  async open(url: string, tabId?: string) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url.replace(/^\/+/, "");
    const t = await this.tab(tabId ?? undefined);
    let target = t;
    if (!tabId) {
      // Fresh tab unless the current one is blank.
      const sid = await this.session(t);
      const info = await this.pageInfo(sid).catch(() => ({ url: "about:blank", title: "" }));
      if (info.url !== "about:blank") {
        const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
        target = this.byTarget.get(targetId) ?? this.register(targetId);
      }
    }
    const sid = await this.session(target);
    target.loading = true;
    const nav = await this.send<{ errorText?: string }>("Page.navigate", { url }, sid);
    if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
    await this.send("Target.activateTarget", { targetId: target.targetId }).catch(() => {});
    await this.waitForLoad(target);
    const info = await this.pageInfo(sid);
    this.opts.log(`browser: open ${info.url} (${target.tabId})`);
    return { tabId: target.tabId, ...info };
  }

  async snapshot(tabId?: string, scrollTo?: number) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    if (scrollTo != null && Number.isFinite(scrollTo)) {
      await this.evaluate(sid, `window.scrollTo(0, ${Math.max(0, scrollTo)})`);
      await sleep(300);
    }
    const r = await this.evaluate<Record<string, unknown>>(sid, SNAPSHOT_SCRIPT);
    return { tabId: t.tabId, ...r };
  }

  private async locate(sid: string, target: string) {
    if (!target) throw new Error("target (ref like e12, or a CSS selector) is required");
    const loc = await this.evaluate<{ error?: string; x: number; y: number; tag: string; text: string }>(sid, LOCATE_SCRIPT(target));
    if (loc.error) throw new Error(loc.error);
    await sleep(80);
    // Re-read after scrollIntoView settled.
    const again = await this.evaluate<{ error?: string; x: number; y: number; tag: string; text: string }>(sid, LOCATE_SCRIPT(target));
    return again.error ? loc : again;
  }

  private async mouseClick(sid: string, x: number, y: number) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sid);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sid);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sid);
  }

  async click(target: string, tabId?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const loc = await this.locate(sid, target);
    await this.mouseClick(sid, loc.x, loc.y);
    await this.waitForLoad(t, 8000);
    const info = await this.pageInfo(sid);
    this.opts.log(`browser: click ${target} <${loc.tag}> on ${t.tabId}`);
    return { tabId: t.tabId, clicked: { tag: loc.tag, text: loc.text }, ...info };
  }

  async type(target: string, text: string, o: { enter: boolean; clear: boolean }, tabId?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const loc = await this.locate(sid, target);
    await this.mouseClick(sid, loc.x, loc.y);
    await sleep(100);
    if (o.clear) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2, commands: ["selectAll"] }, sid);
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, sid);
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 }, sid);
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 }, sid);
    }
    if (text) await this.send("Input.insertText", { text }, sid);
    if (o.enter) {
      await sleep(80);
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }, sid);
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sid);
      await this.waitForLoad(t, 8000);
    } else await sleep(150);
    const info = await this.pageInfo(sid);
    this.opts.log(`browser: typed ${text.length} chars into ${target} on ${t.tabId}`);
    return { tabId: t.tabId, typed: text.length, enter: o.enter, ...info };
  }

  async screenshot(tabId?: string, fullPage = false) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    await this.send("Target.activateTarget", { targetId: t.targetId }).catch(() => {});
    const params: Record<string, unknown> = { format: "png", captureBeyondViewport: fullPage };
    if (fullPage) {
      const m = await this.send<{ contentSize: { width: number; height: number } }>("Page.getLayoutMetrics", {}, sid);
      const height = Math.min(m.contentSize.height, 6000);
      params.clip = { x: 0, y: 0, width: Math.min(m.contentSize.width, 1920), height, scale: 1 };
    }
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", params, sid);
    const dir = path.join(this.opts.workspace(), "inbox");
    await mkdir(dir, { recursive: true });
    const name = `browser-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    await writeFile(path.join(dir, name), Buffer.from(data, "base64"));
    const info = await this.pageInfo(sid);
    this.opts.log(`browser: screenshot ${t.tabId} -> inbox/${name}`);
    return { tabId: t.tabId, path: `inbox/${name}`, mimeType: "image/png", bytes: Math.floor((data.length * 3) / 4), data, ...info };
  }

  async tabsCmd(action: string, tabId?: string) {
    await this.ensure();
    if (action === "close") {
      if (!tabId) throw new Error("tabId is required to close a tab");
      const t = this.tabs.get(tabId);
      if (!t) throw new Error(`Unknown tab ${tabId}`);
      await this.send("Target.closeTarget", { targetId: t.targetId });
      this.forget(t);
      return { closed: tabId, tabs: await this.listTabs() };
    }
    if (action === "activate" && tabId) {
      const t = this.tabs.get(tabId);
      if (!t) throw new Error(`Unknown tab ${tabId}`);
      await this.send("Target.activateTarget", { targetId: t.targetId });
    }
    return { tabs: await this.listTabs() };
  }

  private async listTabs() {
    const pages = await this.refreshTargets();
    return pages.map((p) => ({ tabId: this.byTarget.get(p.targetId)!.tabId, url: p.url, title: p.title }));
  }
}
