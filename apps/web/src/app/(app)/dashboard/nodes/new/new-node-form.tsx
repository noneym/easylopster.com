"use client";

import { SaveButton } from "@/components/app/save-button";
import { useActionState, useState } from "react";
import { createNode, type NodeFormState } from "../actions";

export function NewNodeForm() {
  const [state, action, pending] = useActionState<NodeFormState, FormData>(createNode, undefined);
  const [name, setName] = useState("");
  return (
    <form action={action} className="card p-6 space-y-5 max-w-xl" noValidate>
      <div>
        <label htmlFor="name" className="label">
          Node name
        </label>
        <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="my laptop" required />
        <p className="help">Bots address it as node_&lt;name&gt;_… so short names read better.</p>
        {state?.fieldErrors?.name && <p className="error">{state.fieldErrors.name}</p>}
      </div>
      {state?.error && <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm">{state.error}</p>}
      <SaveButton pending={pending} state={state} pendingLabel="Creating" savedLabel="Created" success="Node created.">
        Create and get pairing code
      </SaveButton>
    </form>
  );
}
