"use client";

import { useState } from "react";

/**
 * Model picker: a <select> over the models the provider reported (or the static fallback list),
 * with an "Other" escape hatch for ids that are not listed.
 */
export function ModelSelect({
  name,
  id,
  models,
  value,
  onChange,
  required,
}: {
  name: string;
  id: string;
  models: string[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const listed = models.includes(value);
  const [custom, setCustom] = useState(!listed && value !== "");
  const useCustom = custom || models.length === 0;

  if (useCustom) {
    return (
      <div className="flex gap-2">
        <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="input font-mono text-sm" placeholder="model id" required={required} />
        {models.length > 0 && (
          <button
            type="button"
            className="btn-ghost h-10 shrink-0 text-sm"
            onClick={() => {
              setCustom(false);
              onChange(models[0]!);
            }}
          >
            Pick from list
          </button>
        )}
      </div>
    );
  }
  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__custom__") {
          setCustom(true);
          onChange("");
        } else onChange(e.target.value);
      }}
      className="input font-mono text-sm"
      required={required}
    >
      {!value && (
        <option value="" disabled>
          Choose a model…
        </option>
      )}
      {!listed && value && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value="__custom__">Other…</option>
    </select>
  );
}
