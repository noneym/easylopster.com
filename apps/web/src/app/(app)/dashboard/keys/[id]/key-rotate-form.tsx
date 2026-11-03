"use client";

import { useActionState, useRef } from "react";
import { SaveButton } from "@/components/app/save-button";
import { rotateKey, type KeyFormState } from "../actions";

/** Replaces the secret in place: tested against the provider first, the old key stays if the test fails. */
export function KeyRotateForm({ id, rotated }: { id: string; rotated: string }) {
  const [state, action, pending] = useActionState<KeyFormState, FormData>(rotateKey, undefined);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="card p-5" noValidate onReset={(e) => e.preventDefault()}>
      <input type="hidden" name="id" value={id} />
      <label htmlFor="rotate-apiKey" className="text-sm text-fg-muted">
        Change key
      </label>
      <p className="mt-1 text-sm">Paste a new secret for this provider. Bots using this key switch to it on their next message.</p>
      <input
        ref={input}
        id="rotate-apiKey"
        name="apiKey"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        placeholder="New API key"
        className="input mt-3"
        aria-invalid={state?.fieldErrors?.apiKey ? true : undefined}
      />
      {state?.fieldErrors?.apiKey && <p className="error">{state.fieldErrors.apiKey}</p>}
      {state?.error && <p className="error">{state.error}</p>}
      {state?.ok && state.message && <p className="mt-1.5 text-sm text-fg-muted">{state.message}</p>}
      <SaveButton pending={pending} state={state} className="btn-secondary mt-3" pendingLabel="Testing" savedLabel="Changed" onSuccess={() => input.current && (input.current.value = "")}>
        Test and replace
      </SaveButton>
      <p className="mt-2 text-xs text-fg-faint">{rotated}</p>
    </form>
  );
}
