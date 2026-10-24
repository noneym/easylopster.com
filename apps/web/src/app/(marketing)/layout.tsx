import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden md:flex items-center gap-7 text-sm text-fg-muted">
            <a href="#how" className="hover:text-fg transition-colors">
              How it works
            </a>
            <a href="#capabilities" className="hover:text-fg transition-colors">
              Capabilities
            </a>
            <a href="#nodes" className="hover:text-fg transition-colors">
              Nodes
            </a>
            <Link href="/changelog" className="hover:text-fg transition-colors">
              Changelog
            </Link>
            <a
              href="https://github.com/noneym/easylopster.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-fg transition-colors"
            >
              Source
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Link href="/dashboard" className="btn-primary h-9">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost h-9 hidden sm:inline-flex">
                  Sign in
                </Link>
                <Link href="/register" className="btn-primary h-9">
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12 grid gap-8 md:grid-cols-[1fr_auto] items-start">
          <div>
            <Logo size={28} />
            <p className="mt-3 max-w-sm text-sm text-fg-muted leading-relaxed">
              A hosted reimagining of the OpenClaw idea: one assistant, in your chat app, with your keys and your machines.
            </p>
            <p className="mt-4 text-sm text-fg-muted">
              Questions, bugs, ideas:{" "}
              <a href="mailto:hello@easylopster.com" className="font-mono text-fg hover:text-accent-ink">
                hello@easylopster.com
              </a>
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm text-fg-muted">
            <a href="#how" className="hover:text-fg">
              How it works
            </a>
            <a href="https://github.com/noneym/easylopster.com" className="hover:text-fg" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="#capabilities" className="hover:text-fg">
              Capabilities
            </a>
            <a href="https://github.com/openclaw/openclaw" className="hover:text-fg" target="_blank" rel="noreferrer">
              OpenClaw
            </a>
            <a href="#nodes" className="hover:text-fg">
              Nodes
            </a>
            <Link href="/login" className="hover:text-fg">
              Sign in
            </Link>
            <Link href="/changelog" className="hover:text-fg">
              Changelog
            </Link>
            <a href="mailto:hello@easylopster.com" className="hover:text-fg">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
