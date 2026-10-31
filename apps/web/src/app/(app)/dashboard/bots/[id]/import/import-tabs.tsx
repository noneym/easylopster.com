"use client";

import { useState, type ReactNode } from "react";
import { FolderOpenIcon, TerminalWindowIcon } from "@phosphor-icons/react";

/** Two ways in: run a command on the OpenClaw machine, or pick the workspace folder in this browser. */
export function ImportTabs({ remote, browser, defaultTab = "remote" }: { remote: ReactNode; browser: ReactNode; defaultTab?: "remote" | "browser" }) {
  const [tab, setTab] = useState<"remote" | "browser">(defaultTab);
  const btn = (id: "remote" | "browser", icon: ReactNode, title: string, help: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 rounded-md border px-4 py-3 text-left transition-colors ${tab === id ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}
    >
      <span className="inline-flex items-center gap-2 font-medium">
        {icon} {title}
      </span>
      <span className="block text-xs text-fg-muted mt-0.5">{help}</span>
    </button>
  );
  return (
    <div className="space-y-6">
      <div role="tablist" className="flex flex-col sm:flex-row gap-3">
        {btn("remote", <TerminalWindowIcon size={16} className="text-accent-ink" />, "Run a command on the OpenClaw machine", "One line in its terminal; this page shows the upload live.")}
        {btn("browser", <FolderOpenIcon size={16} className="text-accent-ink" />, "Pick the folder in this browser", "When the workspace is on this computer.")}
      </div>
      {tab === "remote" ? remote : browser}
    </div>
  );
}
