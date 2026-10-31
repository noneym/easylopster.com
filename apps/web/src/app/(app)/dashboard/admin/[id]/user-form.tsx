"use client";

import { SaveButton } from "@/components/app/save-button";
import { useActionState } from "react";
import { updateUserAdmin, type AdminFormState } from "../actions";

type Limits = { bots: number; nodes: number; mcp: number; messagesPerDay: number };

export function AdminUserForm({
  user,
  defaults,
  self,
}: {
  user: { id: string; role: string; limitBots: number | null; limitNodes: number | null; limitMcp: number | null; limitMessagesPerDay: number | null };
  defaults: Limits;
  self: boolean;
}) {
  const [state, action, pending] = useActionState<AdminFormState, FormData>(updateUserAdmin, undefined);
  const fields: { name: keyof typeof user; label: string; value: number | null; def: number }[] = [
    { name: "limitBots", label: "Agents", value: user.limitBots, def: defaults.bots },
    { name: "limitNodes", label: "Nodes", value: user.limitNodes, def: defaults.nodes },
    { name: "limitMcp", label: "MCP servers", value: user.limitMcp, def: defaults.mcp },
    { name: "limitMessagesPerDay", label: "Messages per day", value: user.limitMessagesPerDay, def: defaults.messagesPerDay },
  ];
  return (
    <form action={action} className="card p-6 space-y-6" noValidate>
      <input type="hidden" name="id" value={user.id} />
      <div>
        <h2 className="font-semibold tracking-tight">Limits</h2>
        <p className="text-sm text-fg-muted mt-1">Leave a field empty to use the global default. Changes apply immediately to the dashboard and the gateway.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name} className="label">
              {f.label}
            </label>
            <input id={f.name} name={f.name} type="number" min={0} step={1} inputMode="numeric" defaultValue={f.value ?? ""} placeholder={`default ${f.def}`} className="input font-mono" />
            {state?.fieldErrors?.[f.name] ? <p className="error">{state.fieldErrors[f.name]}</p> : <p className="help">Default {f.def}</p>}
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="role" className="label">
          Role
        </label>
        <select id="role" name="role" defaultValue={user.role} className="input" disabled={self}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        {self && <input type="hidden" name="role" value="admin" />}
        <p className="help">{self ? "You cannot change your own role." : "Admins see this panel and can sign in as any member."}</p>
      </div>
      <div className="flex items-center gap-3">
        <SaveButton pending={pending} state={state}>
          Save
        </SaveButton>
        {state?.error && <span className="error mt-0!">{state.error}</span>}
      </div>
    </form>
  );
}
