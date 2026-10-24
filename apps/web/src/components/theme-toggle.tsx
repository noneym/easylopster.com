"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";

/**
 * Light/dark switch. Both icons are rendered and CSS picks one via the .dark class, so the button
 * is visible on the server render too (no empty placeholder until hydration).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("el-theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button type="button" onClick={toggle} aria-label="Toggle light / dark theme" title="Light / dark theme" className={`btn-secondary size-9 px-0! text-fg ${className}`}>
      <SunIcon size={20} weight="bold" className="hidden dark:block" aria-hidden />
      <MoonIcon size={20} weight="bold" className="dark:hidden" aria-hidden />
    </button>
  );
}
