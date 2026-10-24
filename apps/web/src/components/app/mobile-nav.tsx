"use client";

import { useState } from "react";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="btn-ghost size-9 px-0 md:hidden">
        <ListIcon size={20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-fg/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-bg-elev border-r border-line p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold tracking-tight">Menu</span>
              <button aria-label="Close" className="btn-ghost size-9 px-0" onClick={() => setOpen(false)}>
                <XIcon size={18} />
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
