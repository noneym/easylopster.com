"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { KeyIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { ModelSelect } from "@/components/app/model-select";
import { RefreshModelsButton } from "@/components/app/refresh-models-button";
import { useToast } from "@/components/app/toaster";
import { setBotModel } from "../../actions";
import { refreshKeyModels } from "../../../keys/actions";
import { TelegramTokenForm } from "../telegram-token-form";

export type KeyChoice = { id: string; label: string; defaultModel: string; models: string[]; provider: string };

/**
 * After an import that skipped the API keys and/or the Telegram token (or found none), the bot
 * needs those two things to be useful; this asks for them right there instead of a note.
 */
export function FinishSetup({ botId, keys, needsKey, wantedModel, tgUsername }: { botId: string; keys: KeyChoice[]; needsKey: boolean; wantedModel: string | null; tgUsername: string | null }) {
  const toast = useToast();
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "");
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const key = keys.find((k) => k.id === keyId);
  const models = lists[keyId] ?? key?.models ?? [];
  const wantedId = wantedModel?.includes("/") ? wantedModel.split("/").slice(1).join("/") : wantedModel;
  const [model, setModel] = useState(wantedId && models.includes(wantedId) ? wantedId : key?.defaultModel ?? "");
  const [keyDone, setKeyDone] = useState(!needsKey);
  const [tg, setTg] = useState(tgUsername);
  const [pending, start] = useTransition();

  const saveModel = () =>
    start(async () => {
      const r = await setBotModel(botId, keyId, model).catch((e: Error) => ({ error: e.message }));
      if ("error" in r && r.error) return toast.push("error", r.error);
      toast.push("success", `Model set: ${model}.`);
      setKeyDone(true);
    });

  if (keyDone && tg) return null;
  return (
    <section className="card p-6 space-y-6 border-accent/40">
      <div>
        <h2 className="font-[650] tracking-[-0.01em]">Finish setup</h2>
        <p className="text-sm text-fg-muted mt-1">The files are in. Two things were left out of the import; add them here and the bot is ready.</p>
      </div>

      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 font-medium">
          {keyDone ? <CheckCircleIcon size={18} weight="fill" className="text-emerald-600" /> : <KeyIcon size={18} className="text-accent-ink" />} API key and model
        </p>
        {keyDone ? (
          <p className="text-sm text-fg-muted">Done. Change it any time in bot settings.</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Your account has no API key yet.{" "}
            <Link href="/dashboard/keys/new" className="underline underline-offset-4 text-fg">
              Add one
            </Link>{" "}
            and come back to this bot's settings to pick the model{wantedModel ? ` (OpenClaw used ${wantedModel})` : ""}.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <label htmlFor="fs-key" className="label">
                API key
              </label>
              <select
                id="fs-key"
                className="input"
                value={keyId}
                onChange={(e) => {
                  setKeyId(e.target.value);
                  const k = keys.find((x) => x.id === e.target.value);
                  const list = lists[e.target.value] ?? k?.models ?? [];
                  setModel(wantedId && list.includes(wantedId) ? wantedId : k?.defaultModel ?? "");
                }}
              >
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fs-model" className="label">
                Model {wantedModel ? <span className="font-normal text-fg-muted">(OpenClaw used {wantedModel})</span> : null}
              </label>
              <ModelSelect id="fs-model" name="fs-model" models={models} value={model} onChange={setModel} />
              <RefreshModelsButton className="mt-1" load={() => refreshKeyModels(keyId)} onModels={(list) => setLists((l) => ({ ...l, [keyId]: list }))} />
            </div>
            <button type="button" onClick={saveModel} disabled={pending || !model} className="btn-primary">
              {pending ? "Saving…" : "Use this model"}
            </button>
          </div>
        )}
        {!keyDone && keys.length > 0 && (
          <p className="text-xs text-fg-muted">
            Need a different provider?{" "}
            <Link href="/dashboard/keys/new" className="underline underline-offset-4 text-fg">
              Add an API key
            </Link>
            .
          </p>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <p className="inline-flex items-center gap-2 font-medium">{tg ? <CheckCircleIcon size={18} weight="fill" className="text-emerald-600" /> : null} Telegram</p>
        {tg ? <p className="text-sm text-fg-muted">Connected as @{tg}.</p> : <TelegramTokenForm botId={botId} tgUsername={null} compact onChanged={setTg} />}
        {!tg && <p className="text-xs text-fg-muted">Optional: skip this and the bot stays in the web chat; you can connect Telegram later from the bot page.</p>}
      </div>
    </section>
  );
}
