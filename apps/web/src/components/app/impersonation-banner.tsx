import { UserSwitchIcon } from "@phosphor-icons/react/dist/ssr";
import { returnToAdmin } from "@/app/(app)/dashboard/admin/actions";

/** Shown on every dashboard page while an admin is signed in as a member. */
export function ImpersonationBanner({ adminEmail, userEmail, userId }: { adminEmail: string; userEmail: string; userId: string }) {
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-accent/40 bg-accent-soft px-4 py-2 text-sm">
      <span className="flex items-center gap-2 min-w-0">
        <UserSwitchIcon size={16} className="shrink-0 text-accent-ink" />
        <span className="truncate">
          Viewing as <strong className="font-medium">{userEmail}</strong>
          <span className="text-fg-muted"> (you are {adminEmail}). Anything you change here changes their account.</span>
        </span>
      </span>
      <form action={returnToAdmin}>
        <input type="hidden" name="back" value={`/dashboard/admin/${userId}`} />
        <button type="submit" className="btn-secondary h-8 text-sm">
          Back to admin
        </button>
      </form>
    </div>
  );
}
