"use client";

/**
 * Submit button with built-in feedback for server-action forms (`useActionState`):
 * a spinner while the action runs, a "Saved" tick for a moment afterwards, a toast for success
 * and errors, and a scroll to the first field error so a validation failure never looks like
 * "nothing happened". Every form in the dashboard uses it instead of a bare <button>.
 */
import { CheckIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "./toaster";

export type ActionState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined | null;

/** Pushes toasts / scrolls to errors whenever a server action settles. Call once per action state. */
export function useActionFeedback(state: ActionState, pending: boolean, opts: { success?: string; onSuccess?: () => void } = {}) {
  const toast = useToast();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const seen = useRef<ActionState>(undefined);
  const wasPending = useRef(false);
  useEffect(() => {
    // A new state object means the action settled (React creates one per submission).
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.ok) {
      setSavedAt(Date.now());
      toast.push("success", state.message || opts.success || "Saved.");
      opts.onSuccess?.();
    } else if (state.error) {
      toast.push("error", state.error);
    } else if (state.fieldErrors && Object.keys(state.fieldErrors).length) {
      const first = Object.values(state.fieldErrors)[0];
      toast.push("error", `Not saved: ${first}`);
      // Field errors are rendered next to their inputs, possibly far above the button.
      requestAnimationFrame(() => document.querySelector(".error, [aria-invalid='true']")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending]);
  useEffect(() => {
    if (savedAt == null) return;
    const t = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);
  return { justSaved: savedAt != null };
}

export function SaveButton({
  pending,
  state,
  children,
  pendingLabel = "Saving",
  savedLabel = "Saved",
  success,
  onSuccess,
  className = "btn-primary",
  formAction,
  disabled,
}: {
  pending: boolean;
  state: ActionState;
  children: React.ReactNode;
  pendingLabel?: string;
  savedLabel?: string;
  /** Toast text on success when the action returns no message. */
  success?: string;
  onSuccess?: () => void;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { justSaved } = useActionFeedback(state, pending, { success, onSuccess });
  return (
    <button type="submit" formAction={formAction} disabled={pending || disabled} aria-busy={pending} className={className}>
      {pending ? (
        <>
          <CircleNotchIcon size={16} className="animate-spin" /> {pendingLabel}
        </>
      ) : justSaved ? (
        <>
          <CheckIcon size={16} weight="bold" /> {savedLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
