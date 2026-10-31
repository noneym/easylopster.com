"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { STORAGE_PROVIDERS, type StorageProvider } from "@/lib/storage";
import { saveStorage, testStorageAction, type StorageFormState } from "./actions";

type Current = { provider: string; endpoint: string; region: string; bucket: string; prefix: string; forcePathStyle: boolean; accessKeyLast4: string } | null;

export function StorageForm({ current }: { current: Current }) {
  const [provider, setProvider] = useState<StorageProvider>((current?.provider as StorageProvider) ?? "r2");
  const info = STORAGE_PROVIDERS[provider];
  const [save, saveAction, saving] = useActionState<StorageFormState, FormData>(saveStorage, undefined);
  const [test, testAction, testing] = useActionState<StorageFormState, FormData>(testStorageAction, undefined);
  const fe = { ...(test?.fieldErrors ?? {}), ...(save?.fieldErrors ?? {}) };
  const [pathStyle, setPathStyle] = useState(current?.forcePathStyle ?? info.pathStyle);

  return (
    <form className="card p-6 space-y-5" noValidate onReset={(e) => e.preventDefault()}>
      <div>
        <h2 className="font-[650] tracking-[-0.01em]">{current ? "Storage connection" : "Connect your storage"}</h2>
        <p className="text-sm text-fg-muted mt-1">
          Your own bucket, your own keys: agents read and write files there with the storage tools, and backups are kept under <span className="font-mono">backups/</span>. Use a key that is limited to this bucket.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="provider" className="label">
            Provider
          </label>
          <select
            id="provider"
            name="provider"
            className="input"
            value={provider}
            onChange={(e) => {
              const p = e.target.value as StorageProvider;
              setProvider(p);
              setPathStyle(STORAGE_PROVIDERS[p].pathStyle);
            }}
          >
            {(Object.keys(STORAGE_PROVIDERS) as StorageProvider[]).map((p) => (
              <option key={p} value={p}>
                {STORAGE_PROVIDERS[p].label}
              </option>
            ))}
          </select>
          {info.docs && (
            <p className="help">
              <a href={info.docs} target="_blank" rel="noreferrer" className="underline underline-offset-4 text-fg">
                Open the provider console
              </a>{" "}
              to create a bucket and an access key.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="bucket" className="label">
            Bucket
          </label>
          <input id="bucket" name="bucket" defaultValue={current?.bucket ?? ""} className="input font-mono" placeholder="my-agents" required />
          {fe.bucket && <p className="error">{fe.bucket}</p>}
        </div>
        <div>
          <label htmlFor="endpoint" className="label">
            Endpoint {provider === "s3" ? <span className="font-normal text-fg-muted">(optional)</span> : null}
          </label>
          <input id="endpoint" name="endpoint" defaultValue={current?.endpoint ?? ""} className="input font-mono text-sm" placeholder={info.endpointHint} />
          {fe.endpoint && <p className="error">{fe.endpoint}</p>}
        </div>
        <div>
          <label htmlFor="region" className="label">
            Region
          </label>
          <input id="region" name="region" defaultValue={current?.region ?? (provider === "r2" ? "auto" : "")} className="input font-mono text-sm" placeholder={info.regionHint} />
        </div>
        <div>
          <label htmlFor="accessKeyId" className="label">
            Access key id {current ? <span className="font-normal text-fg-muted">(saved: …{current.accessKeyLast4}; leave empty to keep)</span> : null}
          </label>
          <input id="accessKeyId" name="accessKeyId" autoComplete="off" spellCheck={false} className="input font-mono text-sm" />
          {fe.accessKeyId && <p className="error">{fe.accessKeyId}</p>}
        </div>
        <div>
          <label htmlFor="secretAccessKey" className="label">
            Secret access key {current ? <span className="font-normal text-fg-muted">(leave empty to keep)</span> : null}
          </label>
          <input id="secretAccessKey" name="secretAccessKey" type="password" autoComplete="off" spellCheck={false} className="input font-mono text-sm" />
          {fe.secretAccessKey && <p className="error">{fe.secretAccessKey}</p>}
        </div>
        <div>
          <label htmlFor="prefix" className="label">
            Folder inside the bucket <span className="font-normal text-fg-muted">(optional)</span>
          </label>
          <input id="prefix" name="prefix" defaultValue={current?.prefix ?? ""} className="input font-mono text-sm" placeholder="easylopster/" />
          <p className="help">Everything we write stays under this folder.</p>
        </div>
        <label className="flex items-start gap-3 cursor-pointer pt-7">
          <input type="checkbox" name="forcePathStyle" checked={pathStyle} onChange={(e) => setPathStyle(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
          <span>
            <span className="font-medium">Path-style URLs</span>
            <span className="block text-sm text-fg-muted">bucket in the path instead of the host name; needed by MinIO and most self-hosted servers.</span>
          </span>
        </label>
      </div>
      {(test?.message || save?.error) && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${save?.error || test?.ok === false ? "border-accent/40 bg-accent-soft" : "border-line bg-bg-sunk"}`}>
          {save?.error ?? test?.message}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <SaveButton pending={testing} state={test} formAction={testAction} disabled={saving} className="btn-secondary" pendingLabel="Testing" savedLabel="Works" success="Storage reachable.">
          Test connection
        </SaveButton>
        <SaveButton pending={saving} state={save} formAction={saveAction} disabled={testing} pendingLabel="Saving" success="Storage connected.">
          {current ? "Save changes" : "Connect storage"}
        </SaveButton>
      </div>
    </form>
  );
}
