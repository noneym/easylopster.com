"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { ModelSelect } from "@/components/app/model-select";
import { RefreshModelsButton } from "@/components/app/refresh-models-button";
import { refreshKeyModels } from "../../keys/actions";
import { createBot, type BotFormState } from "../actions";

type KeyOpt = { id: string; label: string; defaultModel: string; models: string[] };

export function NewBotForm({ keys }: { keys: KeyOpt[] }) {
  const [state, action, pending] = useActionState<BotFormState, FormData>(createBot, undefined);
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "");
  const [modelLists, setModelLists] = useState<Record<string, string[]>>({});
  const key = keys.find((k) => k.id === keyId) ?? keys[0];
  const models = modelLists[keyId] ?? key?.models ?? [];
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [model, setModel] = useState(key?.defaultModel ?? "");
  const [showHow, setShowHow] = useState(false);
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={action} className="card p-6 space-y-6" noValidate onReset={(e) => e.preventDefault()}>
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
          Telegram bot token <span className="font-normal text-fg-muted">(optional)</span>
        </label>
        <input id="token" name="token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} className="input font-mono" placeholder="123456789:AAH…" />
        <p className="help">
          Leave it empty to use the bot in the web chat only; you can add a token later in bot settings. With a token the bot also answers on Telegram: we call getMe to verify it and register the webhook. The token is stored encrypted.{" "}
          <button type="button" className="underline underline-offset-4 text-fg" onClick={() => setShowHow((v) => !v)}>
            {showHow ? "Hide" : "How do I get one?"}
          </button>
        </p>
        {showHow && (
          <ol className="mt-2 rounded-md border border-line bg-bg-sunk px-4 py-3 text-sm text-fg-muted list-decimal pl-8 space-y-1">
            <li>
              In Telegram, open{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline underline-offset-4 text-fg">
                @BotFather
              </a>{" "}
              (the official bot that creates bots) and send <span className="font-mono">/newbot</span>.
            </li>
            <li>
              Answer its two questions: a display name (anything) and a username that must end in <span className="font-mono">bot</span>, e.g. <span className="font-mono">ops_helper_bot</span>.
            </li>
            <li>
              BotFather replies with a token like <span className="font-mono">123456789:AAH…</span>. Copy it into the field above. Keep it secret; anyone with it controls the bot.
            </li>
            <li>Optional: send /setuserpic for an avatar and /setdescription for the intro text. Group use works after you add the bot to the group.</li>
          </ol>
        )}
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
        <ModelSelect id="model" name="model" models={models} value={model} onChange={setModel} />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <RefreshModelsButton load={() => refreshKeyModels(keyId)} onModels={(list) => setModelLists((m) => ({ ...m, [keyId]: list }))} />
          <span className="text-xs text-fg-muted">Defaults to the key's default model.</span>
        </div>
      </div>

      {state?.error && (
        <div role="alert" className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          {state.error}
        </div>
      )}

      <SaveButton pending={pending} state={state} pendingLabel="Creating" savedLabel="Created" success="Bot created.">
        {token.trim() ? "Connect bot" : "Create bot"}
      </SaveButton>
    </form>
  );
}
