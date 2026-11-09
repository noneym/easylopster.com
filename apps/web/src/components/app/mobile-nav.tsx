"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ admin }: { admin?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="btn-ghost size-9 px-0! md:hidden">
        <ListIcon size={20} />
      </button>
      {/* Portal to <body>: the sticky header uses backdrop-filter, which makes it the
          containing block for fixed children and would clip the drawer to its height. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 md:hidden">
            <button aria-label="Close menu" className="absolute inset-0 bg-fg/30" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-bg-elev border-r border-line shadow-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold tracking-tight">Menu</span>
                <button aria-label="Close" className="btn-ghost size-9 px-0!" onClick={() => setOpen(false)}>
                  <XIcon size={18} />
                </button>
              </div>
              <SidebarNav admin={admin} onNavigate={() => setOpen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
