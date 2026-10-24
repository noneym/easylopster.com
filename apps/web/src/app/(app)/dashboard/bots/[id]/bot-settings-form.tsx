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
  exec: string;
  sessionReset: string;
  resetAtHour: number;
  resetIdleMinutes: number;
  ackReaction: string;
  dreaming: boolean;
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
          help="Who the assistant is, how it talks, what it cares about. Written by the bot during onboarding; edit freely here or ask the bot to change it."
        >
          <textarea id="systemPrompt" name="systemPrompt" defaultValue={bot.systemPrompt} rows={8} className="input h-auto py-2 font-mono text-sm leading-relaxed" />
        </Field>
        <Field label="About you (USER.md)" htmlFor="userProfile" help="Name, timezone, preferences, projects. The bot fills this in during onboarding and may update it when you tell it lasting things.">
          <textarea id="userProfile" name="userProfile" defaultValue={bot.userProfile} rows={4} className="input h-auto py-2 font-mono text-sm leading-relaxed" maxLength={20000} />
        </Field>
      </section>

      <section className="card p-6 space-y-5">
        <h2 className="font-semibold tracking-tight">Tools</h2>
        <Field
          label="Shell (exec)"
          htmlFor="exec"
          help="Sandbox: a private Linux container per bot (Debian, python3, node, git, curl). Isolated from everything else; /workspace persists."
        >
          <select id="exec" name="exec" defaultValue={bot.exec} className="input">
            <option value="off">Off</option>
            <option value="sandbox">Cloud sandbox</option>
          </select>
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

      <section className="card p-6 space-y-5">
        <h2 className="font-semibold tracking-tight">Sessions and memory</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Session reset" htmlFor="sessionReset" help="When the main conversation starts fresh. History stays searchable.">
            <select id="sessionReset" name="sessionReset" defaultValue={bot.sessionReset} className="input">
              <option value="none">Never (manual /new)</option>
              <option value="daily">Daily at an hour</option>
              <option value="idle">After idle minutes</option>
            </select>
          </Field>
          <Field label="Daily reset hour" htmlFor="resetAtHour" help="Local hour, 0 to 23.">
            <input id="resetAtHour" name="resetAtHour" type="number" min={0} max={23} defaultValue={bot.resetAtHour} className="input" />
          </Field>
          <Field label="Idle minutes" htmlFor="resetIdleMinutes" help="For the idle policy.">
            <input id="resetIdleMinutes" name="resetIdleMinutes" type="number" min={5} max={10080} defaultValue={bot.resetIdleMinutes} className="input" />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Ack reaction" htmlFor="ackReaction" help="Emoji the bot reacts with when it picks up a message (empty = off), e.g. 👀">
            <input id="ackReaction" name="ackReaction" defaultValue={bot.ackReaction} className="input" maxLength={8} />
          </Field>
          <label className="flex items-start gap-3 text-sm pt-7">
            <input type="checkbox" name="dreaming" defaultChecked={bot.dreaming} className="mt-1 size-4 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">Nightly memory consolidation</span>
              <span className="block text-fg-muted">At 04:00 your time, durable facts from daily notes are promoted into MEMORY.md (review in DREAMS.md).</span>
            </span>
          </label>
        </div>
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
