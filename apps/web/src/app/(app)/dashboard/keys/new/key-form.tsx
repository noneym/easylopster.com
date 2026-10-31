"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "@easylopster/shared/providers";
import { createKey, testKey, type KeyFormState } from "../actions";
import { ModelSelect } from "@/components/app/model-select";

export function KeyForm() {
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState(PROVIDERS.anthropic.defaultModel);
  const [create, createAction, creating] = useActionState<KeyFormState, FormData>(createKey, undefined);
  const [test, testAction, testing] = useActionState<KeyFormState, FormData>(testKey, undefined);
  const info = PROVIDERS[provider];
  const fe = { ...(test?.fieldErrors ?? {}), ...(create?.fieldErrors ?? {}) };
  const models = test?.models?.length ? test.models : info.models.map((m) => m.id);

  return (
    <form className="card p-6 space-y-6 max-w-xl" noValidate onReset={(e) => e.preventDefault()}>
      <div>
        <label htmlFor="provider" className="label">
          Provider
        </label>
        <select
          id="provider"
          name="provider"
          value={provider}
          onChange={(e) => {
            const id = e.target.value as ProviderId;
            setProvider(id);
            setDefaultModel(PROVIDERS[id].defaultModel);
          }}
          className="input"
        >
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>
              {PROVIDERS[id].label}
            </option>
          ))}
        </select>
        <p className="help">
          {info.keyHint}{" "}
          <a href={info.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 text-fg">
            Open console
          </a>
        </p>
      </div>

      <div>
        <label htmlFor="label" className="label">
          Label
        </label>
        <input id="label" name="label" value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder={`${info.label} personal`} required />
        {fe.label && <p className="error">{fe.label}</p>}
      </div>

      <div>
        <label htmlFor="apiKey" className="label">
          API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="input font-mono"
          placeholder={info.keyPrefix ? `${info.keyPrefix}…` : "…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required
        />
        <p className="help">Stored encrypted. Only the last 4 characters are ever shown again.</p>
        {fe.apiKey && <p className="error">{fe.apiKey}</p>}
      </div>

      {(info.needsBaseUrl || info.defaultBaseUrl) && (
        <div>
          <label htmlFor="baseUrl" className="label">
            Base URL {info.needsBaseUrl ? "" : "(optional)"}
          </label>
          <input id="baseUrl" name="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="input font-mono text-sm" placeholder={info.defaultBaseUrl ?? "https://host/v1"} />
          {fe.baseUrl && <p className="error">{fe.baseUrl}</p>}
        </div>
      )}

      <div>
        <label htmlFor="defaultModel" className="label">
          Default model
        </label>
        <ModelSelect id="defaultModel" name="defaultModel" models={models} value={defaultModel} onChange={setDefaultModel} />
        <p className="help">{test?.models?.length ? `${test.models.length} models loaded from the provider.` : "Test the key to load the provider's model list."} Bots can override this.</p>
        {fe.defaultModel && <p className="error">{fe.defaultModel}</p>}
      </div>

      {(test?.message || create?.error) && (
        <div
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            create?.error || test?.ok === false ? "border-accent/40 bg-accent-soft" : "border-line bg-bg-sunk"
          }`}
        >
          {create?.error ?? test?.message}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <SaveButton pending={testing} state={test} formAction={testAction} disabled={creating} className="btn-secondary" pendingLabel="Testing" savedLabel="Works" success="The key works.">
          Test key
        </SaveButton>
        <SaveButton pending={creating} state={create} formAction={createAction} disabled={testing} success="Key saved.">
          Save key
        </SaveButton>
      </div>
    </form>
  );
}
