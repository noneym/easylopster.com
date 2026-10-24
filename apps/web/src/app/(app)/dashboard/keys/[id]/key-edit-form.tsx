"use client";

import { useActionState } from "react";
import { updateKey, type KeyFormState } from "../actions";

export function KeyEditForm({ id, label, defaultModel, models }: { id: string; label: string; defaultModel: string; models: string[] }) {
  const [state, action, pending] = useActionState<KeyFormState, FormData>(updateKey, undefined);
  return (
    <form action={action} className="card p-6 space-y-5" noValidate>
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor="label" className="label">
          Label
        </label>
        <input id="label" name="label" defaultValue={label} className="input" required />
        {state?.fieldErrors?.label && <p className="error">{state.fieldErrors.label}</p>}
      </div>
      <div>
        <label htmlFor="defaultModel" className="label">
          Default model
        </label>
        <input id="defaultModel" name="defaultModel" list="edit-model-ids" defaultValue={defaultModel} className="input font-mono text-sm" required />
        <datalist id="edit-model-ids">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {state?.fieldErrors?.defaultModel && <p className="error">{state.fieldErrors.defaultModel}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          Save
        </button>
        {state?.ok && <span className="text-sm text-fg-muted">{state.message}</span>}
        {state?.error && <span className="text-sm text-accent-ink">{state.error}</span>}
      </div>
    </form>
  );
}
