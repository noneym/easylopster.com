"use client";

import { useActionState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { changePassword, updateProfile, type FormState } from "./actions";
import { TimezoneSelect } from "@/components/app/timezone-select";

export function SettingsForm({ name, email, timezone }: { name: string; email: string; timezone: string }) {
  const [p, profileAction, pPending] = useActionState<FormState, FormData>(updateProfile, undefined);
  const [w, passwordAction, wPending] = useActionState<FormState, FormData>(changePassword, undefined);

  return (
    <>
      <form action={profileAction} className="card p-6 space-y-5" noValidate onReset={(e) => e.preventDefault()}>
        <h2 className="font-semibold tracking-tight">Profile</h2>
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" value={email} readOnly className="input text-fg-muted" />
          <p className="help">Email changes are not available during the beta.</p>
        </div>
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input id="name" name="name" defaultValue={name} className="input" required />
          {p?.fieldErrors?.name && <p className="error">{p.fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="timezone" className="label">
            Time zone
          </label>
          <TimezoneSelect defaultValue={timezone} />
          <p className="help">Bots use it for dates, daily memory files and schedules.</p>
          {p?.fieldErrors?.timezone && <p className="error">{p.fieldErrors.timezone}</p>}
        </div>
        <div className="flex items-center gap-3">
          <SaveButton pending={pPending} state={p}>
            Save
          </SaveButton>
        </div>
      </form>

      <form action={passwordAction} className="card p-6 space-y-5" noValidate>
        <h2 className="font-semibold tracking-tight">Password</h2>
        <div>
          <label htmlFor="current" className="label">
            Current password
          </label>
          <input id="current" name="current" type="password" autoComplete="current-password" className="input" />
          {w?.fieldErrors?.current && <p className="error">{w.fieldErrors.current}</p>}
        </div>
        <div>
          <label htmlFor="next" className="label">
            New password
          </label>
          <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} className="input" />
          {w?.fieldErrors?.next ? <p className="error">{w.fieldErrors.next}</p> : <p className="help">At least 8 characters.</p>}
        </div>
        <div className="flex items-center gap-3">
          <SaveButton pending={wPending} state={w} pendingLabel="Updating" savedLabel="Updated" success="Password updated.">
            Change password
          </SaveButton>
        </div>
      </form>
    </>
  );
}
