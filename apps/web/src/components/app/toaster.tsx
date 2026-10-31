"use client";

/**
 * App-wide toasts: a small stack in the bottom-right corner (bottom-center on phones) that every
 * form uses to say "Saved" or show an error, so the outcome of a click is visible wherever the
 * page is scrolled. Success toasts vanish by themselves; errors stay until dismissed.
 */
import { CheckCircleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type Toast = { id: number; kind: "success" | "error"; text: string };
type Ctx = { push: (kind: Toast["kind"], text: string) => void; dismiss: (id: number) => void };

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      if (kind === "success") setTimeout(() => dismiss(id), 3500);
      else setTimeout(() => dismiss(id), 12_000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg animate-[toast-in_.2s_ease-out] ${
              t.kind === "error" ? "border-accent/40 bg-bg-elev text-fg" : "border-line bg-bg-elev text-fg"
            }`}
          >
            {t.kind === "error" ? <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0 text-accent-ink" /> : <CheckCircleIcon size={18} weight="fill" className="mt-px shrink-0 text-emerald-600" />}
            <span className="min-w-0 break-words">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 ml-1 shrink-0 rounded p-0.5 text-fg-faint hover:text-fg">
              <XIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Returns a no-op pusher outside the provider so components stay usable in isolation. */
export function useToast(): Ctx {
  return useContext(ToastCtx) ?? { push: () => {}, dismiss: () => {} };
}
