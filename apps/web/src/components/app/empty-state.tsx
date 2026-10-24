import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card border-dashed px-6 py-16 text-center">
      <div className="mx-auto size-12 rounded-lg bg-accent-soft text-accent-ink grid place-items-center">{icon}</div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-fg-muted max-w-[46ch] mx-auto leading-relaxed">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
