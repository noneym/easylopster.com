"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { useToast } from "./toaster";

/**
 * "Refresh model list": asks the provider for its current models with the given key and hands the
 * list back to the picker next to it. Two sources: a saved key (by id) or a key being typed in a
 * form (provider + apiKey + baseUrl); the caller passes the matching loader.
 */
export function RefreshModelsButton({ load, onModels, className = "", label = "Refresh model list" }: { load: () => Promise<{ models?: string[]; contexts?: Record<string, number>; error?: string }>; onModels: (models: string[], contexts?: Record<string, number>) => void; className?: string; label?: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [count, setCount] = useState<number | null>(null);
  return (
    <button
      type="button"
      disabled={pending}
      className={`btn-ghost h-8 px-2 text-xs ${className}`}
      onClick={() =>
        start(async () => {
          const r: { models?: string[]; contexts?: Record<string, number>; error?: string } = await load().catch((e: Error) => ({ error: e.message }));
          if (r.error || !r.models?.length) {
            toast.push("error", r.error || "The provider returned no models for this key.");
            return;
          }
          onModels(r.models, r.contexts);
          setCount(r.models.length);
          toast.push("success", `${r.models.length} models loaded from the provider.`);
        })
      }
    >
      <ArrowsClockwiseIcon size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Loading…" : count != null ? `${label} (${count})` : label}
    </button>
  );
}
