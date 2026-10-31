"use client";

import { useActionState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { updateNode, type NodeFormState } from "../actions";

export function NodeSettingsForm({ node, caps, autoApprove, clearAutoApprove }: { node: { id: string; name: string; execApproval: string }; caps: { id: string; label: string; enabled: boolean }[]; autoApprove: string[]; clearAutoApprove: (cap: string) => Promise<void> }) {
  const [state, action, pending] = useActionState<NodeFormState, FormData>(updateNode, undefined);
  return (
    <form action={action} className="card p-6 space-y-6" noValidate>
      <input type="hidden" name="id" value={node.id} />
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" defaultValue={node.name} className="input" required />
        {state?.fieldErrors?.name && <p className="error">{state.fieldErrors.name}</p>}
      </div>

      <div>
        <p className="label">Capabilities bots may use</p>
        {caps.length === 0 ? (
          <p className="text-sm text-fg-muted">The agent reports what it can do on first connection.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {caps.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <input id={`cap-${c.id}`} type="checkbox" name={`cap:${c.id}`} defaultChecked={c.enabled} className="size-4 accent-[var(--accent)]" />
                <label htmlFor={`cap-${c.id}`}>
                  {c.label} <span className="font-mono text-xs text-fg-faint">{c.id}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="help">Everything is off until you enable it here, except what the agent declared minus shell commands.</p>
      </div>

      <div>
        <label htmlFor="execApproval" className="label">
          Shell commands and browser actions
        </label>
        <select id="execApproval" name="execApproval" defaultValue={node.execApproval} className="input max-w-xs">
          <option value="always">Ask me in chat before each command</option>
          <option value="never">Run without asking</option>
        </select>
        <p className="help">With approval on, the bot shows the exact command (or the page to open, element to click, text to type) and waits for your Allow once / Always / Deny tap (5 minutes). Reading pages, screenshots and tab lists never ask.</p>
        {autoApprove.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium">Always allowed on this node</p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {autoApprove.map((cap) => (
                <li key={cap} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-sunk px-2 py-1 text-xs font-mono">
                  {cap}
                  <button type="button" className="text-fg-muted hover:text-accent-ink" title="Ask again" onClick={() => void clearAutoApprove(cap)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p className="help">Answered “Always” in chat. Remove one to be asked again.</p>
          </div>
        )}
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
