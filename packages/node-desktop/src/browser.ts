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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/** Sets a field's value through the native setter so React/Vue style inputs notice. */
const TYPE_FALLBACK_SCRIPT = (target: string, text: string, clear: boolean) => `(() => {
  const t = ${JSON.stringify(target)};
  let el = document.querySelector('[data-lopster-ref="' + t + '"]'); if (!el) { try { el = document.querySelector(t); } catch {} }
  if (!el) return false;
  el.focus();
  if ("value" in el) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const next = (${clear} ? "" : el.value) + ${JSON.stringify(text)};
    if (setter) setter.call(el, next); else el.value = next;
  } else if (el.isContentEditable) { if (${clear}) el.textContent = ""; el.textContent += ${JSON.stringify(text)}; }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

/** Submits the enclosing form when the Enter key did not navigate. */
const SUBMIT_FALLBACK_SCRIPT = (target: string) => `(() => {
  const t = ${JSON.stringify(target)};
  let el = document.querySelector('[data-lopster-ref="' + t + '"]'); if (!el) { try { el = document.querySelector(t); } catch {} }
  const form = el && el.form;
  if (form) { if (form.requestSubmit) form.requestSubmit(); else form.submit(); return true; }
  return false;
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
      case "browser.eval":
        return this.eval(String(p.expression ?? ""), p.tabId ? String(p.tabId) : undefined);
      case "browser.interact":
        return this.interact(String(p.action ?? ""), p, p.tabId ? String(p.tabId) : undefined);
      case "browser.html":
        return this.html(p.tabId ? String(p.tabId) : undefined, p.target ? String(p.target) : undefined);
      case "browser.pdf":
        return this.pdf(p.tabId ? String(p.tabId) : undefined);
      case "browser.cookies":
        return this.cookies(String(p.action ?? "list"), p, p.tabId ? String(p.tabId) : undefined);
      case "browser.upload":
        return this.upload(String(p.target ?? ""), (p.files as string[] | undefined) ?? [], p.tabId ? String(p.tabId) : undefined);
      case "browser.downloads":
        return this.downloads();
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
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
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
        // Downloads land in <workspace>/downloads so the agent (and yt-dlp & co.) can pick them up.
        const dl = path.join(this.opts.workspace(), "downloads");
        void mkdir(dl, { recursive: true })
          .then(() => this.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, eventsEnabled: true }))
          .catch((err) => this.opts.log(`browser: download dir not set: ${(err as Error).message}`));
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

  /** Graceful shutdown so Brave flushes cookies, local storage and logins to the profile; kill only as a last resort. */
  async close() {
    const child = this.child;
    if (this.running) {
      await this.send("Browser.close", {}, undefined, 5_000).catch(() => {});
      const deadline = Date.now() + 6_000;
      while (child && child.exitCode == null && Date.now() < deadline) await sleep(150);
    }
    this.teardown();
    if (child && child.exitCode == null && !child.killed) {
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
      if (ev === "Page.javascriptDialogOpening") {
        // alert/confirm/prompt would block the page forever; accept them and note it in the log.
        this.opts.log(`browser: dialog (${String(params.type)}) "${String(params.message ?? "").slice(0, 120)}" auto-accepted on ${t.tabId}`);
        void this.send("Page.handleJavaScriptDialog", { accept: true, promptText: "" }, msg.sessionId).catch(() => {});
      }
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
    // The Brave window is usually behind other windows; make the page behave as focused so key input lands.
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    return sessionId;
  }

  private async tab(tabId?: string): Promise<TabState> {
    await this.ensure();
    if (tabId) {
      const t = this.tabs.get(tabId);
      if (!t) throw new Error(`Unknown tab ${tabId}. Call browser.tabs to list open tabs.`);
      return t;
    }
    // Default tab: the most recent one that is not blank (a stray about:blank tab must not swallow commands).
    const pages = await this.refreshTargets();
    const usable = [...pages].reverse().find((p) => p.url && p.url !== "about:blank") ?? pages.at(-1);
    const last = usable ? this.byTarget.get(usable.targetId) : undefined;
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
    if (text) {
      await this.send("Input.insertText", { text }, sid);
      // Fallback when the synthetic input was ignored (unfocused window, custom widgets): set the value from JS.
      const landed = await this.evaluate<boolean>(sid, `(() => { const el = document.activeElement; const v = el && ("value" in el ? el.value : el.textContent); return typeof v === "string" && v.includes(${JSON.stringify(text)}); })()`).catch(() => false);
      if (!landed) await this.evaluate(sid, TYPE_FALLBACK_SCRIPT(target, text, o.clear));
    }
    if (o.enter) {
      const before = await this.pageInfo(sid);
      await sleep(80);
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }, sid);
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, sid);
      await sleep(400);
      const after = await this.pageInfo(sid).catch(() => before);
      if (after.url === before.url && !t.loading) await this.evaluate(sid, SUBMIT_FALLBACK_SCRIPT(target)).catch(() => {});
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

  // ───────────────────────── full-control extras ─────────────────────────
  /** Run JavaScript in the page; the awaited result comes back JSON-serialised (truncated at 20k chars). */
  async eval(expression: string, tabId?: string) {
    if (!expression.trim()) throw new Error("expression is required");
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const value = await this.evaluate<unknown>(sid, `(async () => { const __r = (${"\n"}${expression}${"\n"}); return await __r; })()`).catch(async (err) => {
      // Statements (not an expression): run as a function body.
      if (/Unexpected token|Unexpected end|Missing initializer/i.test(String(err))) return this.evaluate<unknown>(sid, `(async () => { ${expression} })()`);
      throw err;
    });
    let text = typeof value === "string" ? value : JSON.stringify(value ?? null);
    const truncated = text.length > 20_000;
    if (truncated) text = text.slice(0, 20_000);
    this.opts.log(`browser: eval ${expression.slice(0, 60).replace(/\s+/g, " ")} on ${t.tabId}`);
    const info = await this.pageInfo(sid).catch(() => ({ url: "", title: "" }));
    return { tabId: t.tabId, result: text, truncated, ...info };
  }

  /** Keyboard, scrolling, hover, select boxes, history navigation and waiting. */
  async interact(action: string, p: Record<string, unknown>, tabId?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    switch (action) {
      case "press": {
        const key = String(p.key ?? "");
        const def = KEYS[key] ?? (key.length === 1 ? { code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key } : null);
        if (!def) throw new Error(`Unknown key ${key}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space, F1-F12 or a single character.`);
        const mods = (p.modifiers as string[] | undefined) ?? [];
        const modifiers = (mods.includes("alt") ? 1 : 0) | (mods.includes("ctrl") ? 2 : 0) | (mods.includes("meta") ? 4 : 0) | (mods.includes("shift") ? 8 : 0);
        if (p.target) {
          const loc = await this.locate(sid, String(p.target));
          await this.mouseClick(sid, loc.x, loc.y);
          await sleep(80);
        }
        const base = { key, code: def.code, windowsVirtualKeyCode: def.vk, modifiers };
        await this.send("Input.dispatchKeyEvent", { type: def.text ? "keyDown" : "rawKeyDown", ...base, ...(def.text ? { text: def.text, unmodifiedText: def.text } : {}) }, sid);
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sid);
        await this.waitForLoad(t, 5000);
        this.opts.log(`browser: press ${mods.length ? mods.join("+") + "+" : ""}${key} on ${t.tabId}`);
        return { tabId: t.tabId, pressed: key, ...(await this.pageInfo(sid)) };
      }
      case "scroll": {
        if (p.target) {
          await this.evaluate(sid, LOCATE_SCRIPT(String(p.target)));
          await sleep(200);
        } else if (p.y != null) await this.evaluate(sid, `window.scrollTo(0, ${Math.max(0, Number(p.y))})`);
        else {
          const dir = String(p.direction ?? "down");
          const amount = Number(p.amount ?? 0) || 0;
          const expr = dir === "top" ? "window.scrollTo(0, 0)" : dir === "bottom" ? "window.scrollTo(0, document.documentElement.scrollHeight)" : dir === "up" ? `window.scrollBy(0, -${amount || "window.innerHeight * 0.8"})` : `window.scrollBy(0, ${amount || "window.innerHeight * 0.8"})`;
          await this.evaluate(sid, expr);
        }
        await sleep(250);
        const pos = await this.evaluate<{ y: number; max: number }>(sid, "({ y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - window.innerHeight) })");
        return { tabId: t.tabId, scrollY: pos.y, maxScrollY: Math.max(0, pos.max) };
      }
      case "hover": {
        const loc = await this.locate(sid, String(p.target ?? ""));
        await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: loc.x, y: loc.y }, sid);
        await sleep(250);
        return { tabId: t.tabId, hovered: { tag: loc.tag, text: loc.text } };
      }
      case "select": {
        const target = String(p.target ?? "");
        const r = await this.evaluate<{ error?: string; value?: string; label?: string; options?: string[] }>(sid, SELECT_SCRIPT(target, p.value != null ? String(p.value) : undefined, p.label != null ? String(p.label) : undefined));
        if (r.error) throw new Error(r.error);
        await this.waitForLoad(t, 3000);
        this.opts.log(`browser: select ${r.label ?? r.value} in ${target} on ${t.tabId}`);
        return { tabId: t.tabId, selected: { value: r.value, label: r.label }, ...(await this.pageInfo(sid)) };
      }
      case "back":
      case "forward":
      case "reload": {
        t.loading = true;
        if (action === "reload") await this.send("Page.reload", { ignoreCache: !!p.hard }, sid);
        else await this.evaluate(sid, action === "back" ? "history.back()" : "history.forward()");
        await this.waitForLoad(t, 20_000);
        return { tabId: t.tabId, ...(await this.pageInfo(sid)) };
      }
      case "wait": {
        const timeout = Math.min(Math.max(Number(p.timeoutMs ?? 10_000), 500), 60_000);
        const deadline = Date.now() + timeout;
        const target = p.target ? String(p.target) : "";
        const text = p.text ? String(p.text) : "";
        if (!target && !text) {
          await sleep(Math.min(timeout, 10_000));
          return { tabId: t.tabId, waited: Math.min(timeout, 10_000), ...(await this.pageInfo(sid)) };
        }
        while (Date.now() < deadline) {
          const found = await this.evaluate<boolean>(sid, WAIT_SCRIPT(target, text)).catch(() => false);
          if (found) return { tabId: t.tabId, found: true, ...(await this.pageInfo(sid)) };
          await sleep(250);
        }
        return { tabId: t.tabId, found: false, error: `Timed out after ${timeout}ms waiting for ${target || JSON.stringify(text)}`, ...(await this.pageInfo(sid)) };
      }
      default:
        throw new Error(`Unknown browser action ${action}`);
    }
  }

  /** Raw HTML of the page or of one element (truncated at 60k chars). */
  async html(tabId?: string, target?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const html = await this.evaluate<string>(sid, target ? `(() => { ${FIND_ONE(target)} return el ? el.outerHTML : ""; })()` : "document.documentElement.outerHTML");
    if (target && !html) throw new Error(`No element matches ${target}`);
    const truncated = html.length > 60_000;
    return { tabId: t.tabId, html: truncated ? html.slice(0, 60_000) : html, truncated, length: html.length, ...(await this.pageInfo(sid)) };
  }

  /** Print the page to PDF under the node workspace inbox/. */
  async pdf(tabId?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const { data } = await this.send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }, sid);
    const dir = path.join(this.opts.workspace(), "inbox");
    await mkdir(dir, { recursive: true });
    const name = `browser-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    await writeFile(path.join(dir, name), Buffer.from(data, "base64"));
    this.opts.log(`browser: pdf ${t.tabId} -> inbox/${name}`);
    return { tabId: t.tabId, path: `inbox/${name}`, mimeType: "application/pdf", bytes: Math.floor((data.length * 3) / 4), data, ...(await this.pageInfo(sid)) };
  }

  /** Cookies of the current page's site (or all): list without values, export as Netscape cookies.txt, import, clear. */
  async cookies(action: string, p: Record<string, unknown>, tabId?: string) {
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const info = await this.pageInfo(sid).catch(() => ({ url: "", title: "" }));
    const all = !!p.all;
    const list = async () => {
      const r = all ? await this.send<{ cookies: CdpCookie[] }>("Storage.getCookies") : await this.send<{ cookies: CdpCookie[] }>("Network.getCookies", info.url ? { urls: [info.url] } : {}, sid);
      return r.cookies ?? [];
    };
    if (action === "list") {
      const cookies = await list();
      return {
        tabId: t.tabId,
        url: info.url,
        count: cookies.length,
        cookies: cookies.slice(0, 200).map((c) => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session", httpOnly: c.httpOnly, secure: c.secure, ...(p.includeValues ? { value: c.value } : {}) })),
      };
    }
    if (action === "export") {
      const cookies = await list();
      const host = (info.url ? new URL(info.url).hostname : "all").replace(/[^a-z0-9.-]/gi, "_");
      const dir = path.join(this.opts.workspace(), "cookies");
      await mkdir(dir, { recursive: true });
      const name = `${all ? "all" : host}.txt`;
      const lines = ["# Netscape HTTP Cookie File", "# Exported by easylopster Node from the controlled Brave profile", ""];
      for (const c of cookies) {
        const domain = c.domain.startsWith(".") ? c.domain : c.domain;
        lines.push([domain, domain.startsWith(".") ? "TRUE" : "FALSE", c.path || "/", c.secure ? "TRUE" : "FALSE", String(Math.floor(c.expires && c.expires > 0 ? c.expires : 0)), c.name, c.value].join("\t"));
      }
      await writeFile(path.join(dir, name), lines.join("\n") + "\n", "utf8");
      this.opts.log(`browser: exported ${cookies.length} cookies -> cookies/${name}`);
      return { tabId: t.tabId, url: info.url, count: cookies.length, path: `cookies/${name}`, format: "netscape", note: "Use it from exec, e.g. yt-dlp --cookies <shared folder>/cookies/<file>." };
    }
    if (action === "import") {
      const rel = String(p.path ?? "");
      if (!rel) throw new Error("path (a Netscape cookies.txt inside the shared folder) is required");
      const abs = path.resolve(this.opts.workspace(), rel.replace(/^[\\/]+/, ""));
      if (!abs.startsWith(path.resolve(this.opts.workspace()) + path.sep)) throw new Error("path escapes the shared folder");
      const text = await readFile(abs, "utf8");
      const cookies: Record<string, unknown>[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const f = line.split("\t");
        if (f.length < 7) continue;
        const expires = Number(f[4]);
        cookies.push({ name: f[5], value: f[6], domain: f[0], path: f[2] || "/", secure: f[3] === "TRUE", ...(expires > 0 ? { expires } : {}) });
      }
      if (!cookies.length) throw new Error("No cookies found in the file (expected Netscape format).");
      await this.send("Storage.setCookies", { cookies });
      this.opts.log(`browser: imported ${cookies.length} cookies from ${rel}`);
      return { imported: cookies.length };
    }
    if (action === "clear") {
      if (all) await this.send("Storage.clearCookies");
      else {
        const cookies = await list();
        for (const c of cookies) await this.send("Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path }, sid).catch(() => {});
        return { tabId: t.tabId, cleared: cookies.length };
      }
      return { cleared: "all" };
    }
    throw new Error(`Unknown cookies action ${action}`);
  }

  /** Attach files from the shared folder to an <input type=file>. */
  async upload(target: string, files: string[], tabId?: string) {
    if (!target) throw new Error("target (ref or CSS selector of the file input) is required");
    if (!files.length) throw new Error("files (paths inside the shared folder) are required");
    const root = path.resolve(this.opts.workspace());
    const abs = files.map((f) => {
      const a = path.resolve(root, String(f).replace(/^[\\/]+/, ""));
      if (!a.startsWith(root + path.sep)) throw new Error(`path escapes the shared folder: ${f}`);
      return a;
    });
    const t = await this.tab(tabId);
    const sid = await this.session(t);
    const { root: doc } = await this.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 }, sid);
    const selector = /^e\d+$/.test(target) ? `[data-lopster-ref="${target}"]` : target;
    const { nodeId } = await this.send<{ nodeId: number }>("DOM.querySelector", { nodeId: doc.nodeId, selector }, sid);
    if (!nodeId) throw new Error(`No element matches ${target}. Take a snapshot and use the ref of the file input.`);
    await this.send("DOM.setFileInputFiles", { files: abs, nodeId }, sid);
    await sleep(300);
    this.opts.log(`browser: attached ${abs.length} file(s) to ${target} on ${t.tabId}`);
    return { tabId: t.tabId, attached: abs.map((a) => path.relative(root, a).split(path.sep).join("/")), ...(await this.pageInfo(sid)) };
  }

  /** Files in <workspace>/downloads (where the browser saves downloads). */
  async downloads() {
    const dir = path.join(this.opts.workspace(), "downloads");
    await mkdir(dir, { recursive: true });
    const { readdir, stat } = await import("node:fs/promises");
    const names = await readdir(dir);
    const files = [];
    for (const n of names) {
      const s = await stat(path.join(dir, n)).catch(() => null);
      if (s?.isFile()) files.push({ path: `downloads/${n}`, bytes: s.size, modifiedAt: s.mtime.toISOString(), inProgress: /\.crdownload$/i.test(n) });
    }
    files.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    return { dir: "downloads/", files: files.slice(0, 100) };
  }

  private async listTabs() {
    const pages = await this.refreshTargets();
    return pages.map((p) => ({ tabId: this.byTarget.get(p.targetId)!.tabId, url: p.url, title: p.title }));
  }
}

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 },
  Delete: { code: "Delete", vk: 46 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  PageUp: { code: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", vk: 34 },
  Space: { code: "Space", vk: 32, text: " " },
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, { code: `F${i + 1}`, vk: 112 + i }])),
};

/** JS fragment: `const el = …` resolving a ref (e12) or CSS selector. */
function FIND_ONE(target: string): string {
  const t = JSON.stringify(target);
  return `let el = document.querySelector('[data-lopster-ref="' + ${t} + '"]'); if (!el) { try { el = document.querySelector(${t}); } catch {} }`;
}

function SELECT_SCRIPT(target: string, value?: string, label?: string): string {
  return `(() => { ${FIND_ONE(target)}
    if (!el) return { error: "No element matches " + ${JSON.stringify(target)} };
    if (el.tagName !== "SELECT") { const inner = el.querySelector && el.querySelector("select"); if (inner) el = inner; else return { error: "Not a <select>: " + el.tagName }; }
    const opts = [...el.options];
    const want = ${JSON.stringify(value ?? null)}; const wantLabel = ${JSON.stringify(label ?? null)};
    let o = want != null ? opts.find((x) => x.value === want) : null;
    if (!o && wantLabel != null) o = opts.find((x) => x.textContent.trim().toLowerCase() === wantLabel.toLowerCase()) || opts.find((x) => x.textContent.trim().toLowerCase().includes(wantLabel.toLowerCase()));
    if (!o && want != null) o = opts.find((x) => x.textContent.trim().toLowerCase() === want.toLowerCase());
    if (!o) return { error: "No option matches", options: opts.slice(0, 50).map((x) => x.textContent.trim() + " [" + x.value + "]") };
    el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    return { value: o.value, label: o.textContent.trim() };
  })()`;
}

function WAIT_SCRIPT(target: string, text: string): string {
  return `(() => { let ok = true;
    if (${JSON.stringify(target)}) { ${FIND_ONE(target)} ok = ok && !!el && (el.offsetParent !== null || el.getClientRects().length > 0); }
    if (${JSON.stringify(text)}) { ok = ok && (document.body?.innerText || "").includes(${JSON.stringify(text)}); }
    return ok; })()`;
}

type CdpCookie = { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean };
