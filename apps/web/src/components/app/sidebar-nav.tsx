"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DesktopIcon,
  GearSixIcon,
  KeyIcon,
  LockKeyIcon,
  PlugsConnectedIcon,
  RobotIcon,
  SquaresFourIcon,
  type Icon,
} from "@phosphor-icons/react";

const ITEMS: { href: string; label: string; icon: Icon; exact?: boolean }[] = [
  { href: "/dashboard", label: "Overview", icon: SquaresFourIcon, exact: true },
  { href: "/dashboard/bots", label: "Bots", icon: RobotIcon },
  { href: "/dashboard/keys", label: "API keys", icon: KeyIcon },
  { href: "/dashboard/mcp", label: "MCP servers", icon: PlugsConnectedIcon },
  { href: "/dashboard/nodes", label: "Nodes", icon: DesktopIcon },
  { href: "/dashboard/secrets", label: "Secrets", icon: LockKeyIcon },
  { href: "/dashboard/settings", label: "Settings", icon: GearSixIcon },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 h-9 text-sm transition-colors ${
              active ? "bg-bg-sunk text-fg font-medium" : "text-fg-muted hover:text-fg hover:bg-bg-sunk/70"
            }`}
          >
            <it.icon size={18} weight={active ? "fill" : "regular"} />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
