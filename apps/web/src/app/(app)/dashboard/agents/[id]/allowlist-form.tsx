"use client";

import { useActionState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { addAllowlistEntry, type BotFormState } from "../actions";

export function AllowlistForm({ botId }: { botId: string }) {
  const [state, action, pending] = useActionState<BotFormState, FormData>(addAllowlistEntry, undefined);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[110px_1fr_1fr_auto] items-end" noValidate>
      <input type="hidden" name="botId" value={botId} />
      <div>
        <label htmlFor="al-kind" className="label">
          Kind
        </label>
        <select id="al-kind" name="kind" className="input">
          <option value="user">User</option>
          <option value="group">Group</option>
        </select>
      </div>
      <div>
        <label htmlFor="al-id" className="label">
          Telegram id
        </label>
        <input id="al-id" name="tgId" className="input font-mono text-sm" placeholder="603767951" />
      </div>
      <div>
        <label htmlFor="al-label" className="label">
          Label
        </label>
        <input id="al-label" name="label" className="input" placeholder="optional" />
      </div>
      <SaveButton pending={pending} state={state} className="btn-secondary" pendingLabel="Adding" savedLabel="Added" success="Added to the allowlist.">
        Add
      </SaveButton>
      {(state?.fieldErrors?.tgId || state?.error) && <p className="error sm:col-span-4">{state.fieldErrors?.tgId ?? state.error}</p>}
    </form>
  );
}
