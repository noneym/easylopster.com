"use client";

import { useActionState, useEffect, useState } from "react";
import { createSecret, type SecretFormState } from "./actions";

export function SecretForm() {
  const [state, action, pending] = useActionState<SecretFormState, FormData>(createSecret, undefined);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (state?.ok) {
      setName("");
      setValue("");
      setDescription("");
    }
  }, [state]);
  return (
    <form action={action} className="card p-6 space-y-5 self-start" noValidate>
      <h2 className="font-semibold tracking-tight">Add or replace a secret</h2>
      <div>
        <label htmlFor="s-name" className="label">
          Name
        </label>
        <input id="s-name" name="name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="input font-mono text-sm" placeholder="GITHUB_TOKEN" required />
        <p className="help">Becomes the environment variable $NAME in exec.</p>
        {state?.fieldErrors?.name && <p className="error">{state.fieldErrors.name}</p>}
      </div>
      <div>
        <label htmlFor="s-value" className="label">
          Value
        </label>
        <textarea id="s-value" name="value" value={value} onChange={(e) => setValue(e.target.value)} rows={3} className="input h-auto py-2 font-mono text-sm" autoComplete="off" spellCheck={false} required />
        {state?.fieldErrors?.value && <p className="error">{state.fieldErrors.value}</p>}
      </div>
      <div>
        <label htmlFor="s-desc" className="label">
          Description (shown to the bot)
        </label>
        <input id="s-desc" name="description" value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="GitHub personal access token, repo scope" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Saving" : "Save secret"}
      </button>
      {state?.ok && <p className="text-sm text-fg-muted">Saved. Enable it on a bot's page.</p>}
    </form>
  );
}
