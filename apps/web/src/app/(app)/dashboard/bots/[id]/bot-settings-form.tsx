"use client";

import { useActionState, useState } from "react";
import { updateBot, type BotFormState } from "../actions";
import { ModelSelect } from "@/components/app/model-select";

type KeyOpt = { id: string; label: string; defaultModel: string; models: string[] };
type BotValues = {
  id: string;
  name: string;
  agentName: string;
  providerKeyId: string;
  model: string;
  thinking: string;
  systemPrompt: string;
  userProfile: string;
  dmPolicy: string;
  groupPolicy: string;
  requireMention: boolean;
  streaming: string;
  replyToMode: string;
};

function Field({ label, htmlFor, help, error, children }: { label: string; htmlFor: string; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {error ? <p className="error">{error}</p> : help ? <p className="help">{help}</p> : null}
    </div>
  );
}

export function BotSettingsForm({ bot, keys }: { bot: BotValues; keys: KeyOpt[] }) {
  const [state, action, pending] = useActionState<BotFormState, FormData>(updateBot, undefined);
  const [keyId, setKeyId] = useState(bot.providerKeyId || keys[0]?.id || "");
  const key = keys.find((k) => k.id === keyId);
  const [model, setModel] = useState(bot.model || key?.defaultModel || "");
  const fe = state?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="id" value={bot.id} />

      <section className="card p-6 space-y-5">
        <h2 className="font-semibold tracking-tight">Model</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" error={fe.name}>
            <input id="name" name="name" defaultValue={bot.name} className="input" required />
          </Field>
          <Field label="Assistant name in prompts" htmlFor="agentName" help="Defaults to the bot name.">
            <input id="agentName" name="agentName" defaultValue={bot.agentName} className="input" />
          </Field>
          <Field label="API key" htmlFor="providerKeyId" error={fe.providerKeyId}>
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
          </Field>
          <Field label="Model" htmlFor="model" error={fe.model}>
            <ModelSelect id="model" name="model" models={key?.models ?? []} value={model} onChange={setModel} required />
          </Field>
          <Field label="Thinking" htmlFor="thinking" help="Extended reasoning where the model supports it.">
            <select id="thinking" name="thinking" defaultValue={bot.thinking} className="input">
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="card p-6 space-y-5">
        <h2 className="font-semibold tracking-tight">Persona</h2>
        <Field
          label="Instructions (SOUL.md)"
          htmlFor="systemPrompt"
          help="Who the assistant is, how it talks, what it cares about. Injected after the runtime instructions."
        >
          <textarea id="systemPrompt" name="systemPrompt" defaultValue={bot.systemPrompt} rows={8} className="input h-auto py-2 font-mono text-sm leading-relaxed" />
        </Field>
        <Field label="About you (USER.md)" htmlFor="userProfile" help="Name, timezone, preferences, projects. Max 4000 characters.">
          <textarea id="userProfile" name="userProfile" defaultValue={bot.userProfile} rows={4} className="input h-auto py-2 font-mono text-sm leading-relaxed" maxLength={4000} />
        </Field>
      </section>

      <section className="card p-6 space-y-5">
        <h2 className="font-semibold tracking-tight">Access and delivery</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Direct messages" htmlFor="dmPolicy" help="Pairing: strangers get a code you approve here.">
            <select id="dmPolicy" name="dmPolicy" defaultValue={bot.dmPolicy} className="input">
              <option value="pairing">Pairing (recommended)</option>
              <option value="allowlist">Allowlist only</option>
              <option value="open">Anyone</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>
          <Field label="Groups" htmlFor="groupPolicy" help="Allowlist: only groups you add below.">
            <select id="groupPolicy" name="groupPolicy" defaultValue={bot.groupPolicy} className="input">
              <option value="allowlist">Allowlisted groups</option>
              <option value="open">Any group</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>
          <Field label="Streaming" htmlFor="streaming" help="Partial edits the reply as it is written. Off sends the final answer only.">
            <select id="streaming" name="streaming" defaultValue={bot.streaming} className="input">
              <option value="partial">Partial (live edits)</option>
              <option value="off">Off</option>
              <option value="block">Block (paragraph by paragraph)</option>
              <option value="progress">Progress (status draft, final as new message)</option>
            </select>
          </Field>
          <Field label="Reply threading" htmlFor="replyToMode" help="Whether replies quote the triggering message.">
            <select id="replyToMode" name="replyToMode" defaultValue={bot.replyToMode} className="input">
              <option value="first">First message of a turn</option>
              <option value="all">Every message</option>
              <option value="off">Never</option>
            </select>
          </Field>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="requireMention" defaultChecked={bot.requireMention} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="font-medium">In groups, answer only when mentioned</span>
            <span className="block text-fg-muted">Replies to the bot's own messages also count as a mention.</span>
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving" : "Save changes"}
        </button>
        {state?.ok && <span className="text-sm text-fg-muted">{state.message}</span>}
        {state?.error && <span className="text-sm text-accent-ink">{state.error}</span>}
      </div>
    </form>
  );
}
