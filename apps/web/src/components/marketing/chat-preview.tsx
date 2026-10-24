"use client";

import { motion, useReducedMotion } from "motion/react";
import { CheckIcon, PaperPlaneRightIcon, WrenchIcon } from "@phosphor-icons/react";
import { ClawMark } from "@/components/logo";

/**
 * A working miniature of the product surface: the conversation a user actually has with their bot.
 * Rendered as a real component (not a screenshot) so it adapts to theme and width.
 */
type Line =
  | { kind: "user"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "bot"; text: string };

const LINES: Line[] = [
  { kind: "user", text: "What's eating disk on the build server?" },
  { kind: "tool", text: "exec on node build-01: du -sh /var/lib/docker/*" },
  { kind: "bot", text: "Docker build cache is 41 GB. Overlay2 layers from images you no longer run. Want me to prune dangling images only?" },
  { kind: "user", text: "yes, dangling only" },
  { kind: "tool", text: "exec on node build-01: docker image prune -f" },
  { kind: "bot", text: "Done. Reclaimed 27.3 GB. Free space on / is now 118 GB." },
];

export function ChatPreview() {
  const reduce = useReducedMotion();
  const stagger = reduce ? 0 : 0.5;

  return (
    <div className="card overflow-hidden shadow-[0_24px_60px_-30px_hsl(var(--shadow-tint)/0.35)]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="size-9 rounded-full bg-[#111214] grid place-items-center text-accent" aria-hidden>
          <ClawMark size={22} teeth={false} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-medium">ops assistant</p>
          <p className="text-xs text-fg-muted">bot · node build-01 online</p>
        </div>
      </div>

      <ul className="space-y-3 px-4 py-5 min-h-[340px]">
        {LINES.map((line, i) => (
          <motion.li
            key={i}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 + i * stagger, ease: [0.16, 1, 0.3, 1] }}
            className={line.kind === "user" ? "flex justify-end" : "flex justify-start"}
          >
            {line.kind === "tool" ? (
              <span className="inline-flex items-center gap-2 rounded-md bg-bg-sunk px-2.5 py-1.5 font-mono text-[11px] text-fg-muted">
                <WrenchIcon size={12} />
                {line.text}
                <CheckIcon size={12} className="text-accent-ink" />
              </span>
            ) : (
              <span
                className={
                  line.kind === "user"
                    ? "max-w-[78%] rounded-lg rounded-br-sm bg-accent text-accent-fg px-3.5 py-2 text-sm leading-relaxed"
                    : "max-w-[85%] rounded-lg rounded-bl-sm bg-bg-sunk px-3.5 py-2 text-sm leading-relaxed"
                }
              >
                {line.text}
              </span>
            )}
          </motion.li>
        ))}
      </ul>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <div className="input h-9 flex items-center text-fg-faint select-none" aria-hidden>
          Message
        </div>
        <span className="size-9 shrink-0 rounded-md bg-accent text-accent-fg grid place-items-center" aria-hidden>
          <PaperPlaneRightIcon size={16} weight="fill" />
        </span>
      </div>
    </div>
  );
}
