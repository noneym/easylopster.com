import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden lg:flex flex-col justify-between p-10 bg-bg-sunk border-r border-line">
        <Logo />
        <div className="max-w-md">
          <p className="text-2xl font-medium tracking-tight leading-snug text-fg">
            Your assistant, in the chat app you already open fifty times a day.
          </p>
          <p className="mt-4 text-fg-muted leading-relaxed">
            Paste an API key, paste a bot token, start talking. Add MCP servers and your own machine when you need more.
          </p>
        </div>
        <p className="text-sm text-fg-faint">Free during the beta.</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6 lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
