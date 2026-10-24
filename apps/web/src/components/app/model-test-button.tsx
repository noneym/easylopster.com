"use client";

import { useState, useTransition } from "react";
import { CheckCircleIcon, WarningCircleIcon, LightningIcon } from "@phosphor-icons/react";
import { testModel, type ModelTestResult } from "@/app/(app)/dashboard/bots/actions";

/** "Does this key + model actually answer?" One tiny prompt through the gateway; shows latency or the provider's error. */
export function ModelTestButton({ keyId, model, thinking = "off" }: { keyId: string; model: string; thinking?: string }) {
  const [result, setResult] = useState<ModelTestResult | null>(null);
  const [pending, start] = useTransition();
  const [tested, setTested] = useState<string>("");

  function run() {
    setResult(null);
    setTested(model);
    start(async () => setResult(await testModel(keyId, model, thinking)));
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <button type="button" onClick={run} disabled={pending || !keyId || !model} className="btn-secondary h-8">
        <LightningIcon size={14} weight="bold" />
        {pending ? "Asking the model…" : "Test this model"}
      </button>
      {result && tested === model && (
        <span className={`inline-flex items-center gap-1.5 ${result.ok ? "text-fg-muted" : "text-accent-ink"}`}>
          {result.ok ? <CheckCircleIcon size={16} weight="fill" className="text-accent" /> : <WarningCircleIcon size={16} weight="fill" />}
          {result.ok ? (
            <>
              Answered in {(result.ms / 1000).toFixed(1)}s{result.reply ? <span className="font-mono text-xs text-fg-faint">· “{result.reply.slice(0, 40)}”</span> : null}
            </>
          ) : (
            <span className="break-all">{result.error ?? "No answer"}</span>
          )}
        </span>
      )}
      {result && tested !== model && <span className="text-xs text-fg-faint">Model changed, test again.</span>}
    </div>
  );
}
