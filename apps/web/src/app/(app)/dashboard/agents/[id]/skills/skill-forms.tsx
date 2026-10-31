"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { createSkill, importSkill, type SkillFormState } from "./actions";

export function NewSkillForm({ botId }: { botId: string }) {
  const [state, action, pending] = useActionState<SkillFormState, FormData>(createSkill, undefined);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  return (
    <form action={action} className="card p-5 space-y-3">
      <input type="hidden" name="botId" value={botId} />
      <div>
        <h2 className="font-semibold tracking-tight">New skill</h2>
        <p className="text-sm text-fg-muted mt-0.5">Starts from a template and opens the editor.</p>
      </div>
      <div>
        <label htmlFor="skill-name" className="label">
          Name
        </label>
        <input
          id="skill-name"
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slug || slug === toSlug(name)) setSlug(toSlug(e.target.value));
          }}
          className="input"
          placeholder="Weekly report"
          required
        />
      </div>
      <div>
        <label htmlFor="skill-slug" className="label">
          Folder
        </label>
        <div className="flex items-center gap-1 text-sm">
          <span className="font-mono text-fg-faint">skills/</span>
          <input id="skill-slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} className="input font-mono" placeholder="weekly-report" pattern="[a-z0-9][a-z0-9-]{1,40}" required />
        </div>
      </div>
      {state?.error && <p className="error">{state.error}</p>}
      <SaveButton pending={pending} state={state} pendingLabel="Creating" savedLabel="Created" success="Skill created.">
        Create and edit
      </SaveButton>
    </form>
  );
}

export function ImportSkillForm({ botId }: { botId: string }) {
  const [state, action, pending] = useActionState<SkillFormState, FormData>(importSkill, undefined);
  const [url, setUrl] = useState("");
  return (
    <form action={action} className="card p-5 space-y-3">
      <input type="hidden" name="botId" value={botId} />
      <div>
        <h2 className="font-semibold tracking-tight">Import from URL</h2>
        <p className="text-sm text-fg-muted mt-0.5">A raw SKILL.md link (GitHub raw, a gist, your own server). Frontmatter is added when missing.</p>
      </div>
      <div>
        <label htmlFor="skill-url" className="label">
          URL
        </label>
        <input id="skill-url" name="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="input font-mono text-sm" placeholder="https://raw.githubusercontent.com/…/SKILL.md" required />
      </div>
      {state?.error && <p className="error">{state.error}</p>}
      <SaveButton pending={pending} state={state} className="btn-secondary" pendingLabel="Importing" savedLabel="Imported" success="Imported. The bot sees it on its next message.">
        Import
      </SaveButton>
    </form>
  );
}

function toSlug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
