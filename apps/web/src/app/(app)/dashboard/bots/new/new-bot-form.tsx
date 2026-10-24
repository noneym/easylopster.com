"use client";

import { useActionState, useState } from "react";
import { createBot, type BotFormState } from "../actions";
import { ModelSelect } from "@/components/app/model-select";

type KeyOpt = { id: string; label: string; defaultModel: string; models: string[] };

export function NewBotForm({ keys }: { keys: KeyOpt[] }) {
  const [state, action, pending] = useActionState<BotFormState, FormData>(createBot, undefined);
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "");
  const key = keys.find((k) => k.id === keyId) ?? keys[0];
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [model, setModel] = useState(key?.defaultModel ?? "");
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={action} className="card p-6 space-y-6 max-w-xl" noValidate onReset={(e) => e.preventDefault()}>
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="ops assistant" required />
        <p className="help">Shown in your dashboard and used as the assistant's name in prompts.</p>
        {fe.name && <p className="error">{fe.name}</p>}
      </div>
      <div>
        <label htmlFor="token" className="label">
          Bot token
        </label>
        <input id="token" name="token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} className="input font-mono" placeholder="123456789:AAH…" required />
        <p className="help">We call getMe to verify it, then register the webhook. The token is stored encrypted.</p>
        {fe.token && <p className="error">{fe.token}</p>}
      </div>
      <div>
        <label htmlFor="providerKeyId" className="label">
          API key
        </label>
        <select
          id="providerKeyId"
          name="providerKeyId"
          value={keyId}
          onChange={(e) => {
            setKeyId(e.target.value);
            setModel(keys.find((k) => k.id === e.target.value)?.defaultModel ?? "");
          }}
          className="input"
        >
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        {fe.providerKeyId && <p className="error">{fe.providerKeyId}</p>}
      </div>
      <div>
        <label htmlFor="model" className="label">
          Model
        </label>
        <ModelSelect id="model" name="model" models={key?.models ?? []} value={model} onChange={setModel} />
        <p className="help">Defaults to the key's default model.</p>
      </div>

      {state?.error && (
        <div role="alert" className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          {state.error}
        </div>
      )}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Connecting" : "Connect bot"}
      </button>
    </form>
  );
}
