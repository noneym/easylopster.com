import { SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { MobileNav } from "@/components/app/mobile-nav";
import { getImpersonator, requireUser } from "@/lib/auth";
import { ImpersonationBanner } from "@/components/app/impersonation-banner";
import { ToastProvider } from "@/components/app/toaster";
import { logout, resendVerification } from "@/app/(auth)/actions";
import { APP_VERSION } from "@easylopster/shared/version";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await requireUser();
  const impersonator = await getImpersonator();
  const isAdmin = user.role === "admin";
  return (
    <ToastProvider>
      <div className="min-h-[100dvh] md:grid md:grid-cols-[240px_1fr]">
        <aside className="hidden md:flex flex-col border-r border-line bg-bg-elev/60 p-4 sticky top-0 h-[100dvh]">
          <div className="px-3 h-10 flex items-center">
            <Logo href="/dashboard" />
          </div>
          <div className="mt-6 flex-1">
            <SidebarNav admin={isAdmin} />
          </div>
          <div className="border-t border-line pt-3 px-1">
            <p className="truncate text-sm font-medium px-2">{user.name ?? user.email}</p>
            <p className="truncate text-xs text-fg-muted px-2">{user.email}</p>
            <p className="px-2 text-[10px] text-fg-faint font-mono">v{APP_VERSION}</p>
            <div className="mt-2 flex items-center justify-between">
              <ThemeToggle />
              <form action={logout}>
                <button type="submit" className="btn-ghost h-9 text-sm">
                  <SignOutIcon size={16} />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </aside>

        <div className="flex flex-col min-w-0">
          {impersonator && impersonator.id !== user.id && <ImpersonationBanner adminEmail={impersonator.email} userEmail={user.email} userId={user.id} />}
          <header className="md:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 backdrop-blur px-3">
            <div className="flex items-center gap-1">
              <MobileNav admin={isAdmin} />
              <Logo href="/dashboard" />
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <form action={logout}>
                <button type="submit" aria-label="Sign out" className="btn-ghost size-9 px-0!">
                  <SignOutIcon size={18} />
                </button>
              </form>
            </div>
          </header>
          <main className="flex-1 px-4 sm:px-8 py-8 max-w-6xl w-full">
            {!user.emailVerifiedAt && process.env.EMAIL_VERIFICATION === "on" && (
              <form action={resendVerification} className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
                <span>Please verify your email address. Check your inbox for the link.</span>
                <button type="submit" className="btn-secondary h-8">
                  Resend email
                </button>
              </form>
            )}
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
