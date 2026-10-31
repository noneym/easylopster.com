"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { updateKey, type KeyFormState } from "../actions";
import { ModelSelect } from "@/components/app/model-select";
import { ModelTestButton } from "@/components/app/model-test-button";

export function KeyEditForm({ id, label, defaultModel, models }: { id: string; label: string; defaultModel: string; models: string[] }) {
  const [state, action, pending] = useActionState<KeyFormState, FormData>(updateKey, undefined);
  const [model, setModel] = useState(defaultModel);
  return (
    <form action={action} className="card p-6 space-y-5" noValidate onReset={(e) => e.preventDefault()}>
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
        <ModelSelect id="defaultModel" name="defaultModel" models={models} value={model} onChange={setModel} required />
        <ModelTestButton keyId={id} model={model} />
        <p className="help">{models.length} models known for this key. "Test again" refreshes the list.</p>
        {state?.fieldErrors?.defaultModel && <p className="error">{state.fieldErrors.defaultModel}</p>}
      </div>
      <div className="flex items-center gap-3">
        <SaveButton pending={pending} state={state}>
          Save
        </SaveButton>
        {state?.error && <span className="text-sm text-accent-ink">{state.error}</span>}
      </div>
    </form>
  );
}
