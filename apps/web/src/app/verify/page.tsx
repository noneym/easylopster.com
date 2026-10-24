import Link from "next/link";
import { consumeVerificationToken } from "@/lib/verification";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const ok = token ? await consumeVerificationToken(token) : false;
  return (
    <main className="min-h-[100dvh] grid place-items-center px-4">
      <div className="card p-8 max-w-sm text-center">
        <h1 className="text-xl font-semibold tracking-tight">{ok ? "Email verified" : "Link invalid or expired"}</h1>
        <p className="mt-2 text-sm text-fg-muted">{ok ? "Thanks, your address is confirmed." : "Request a new verification email from the dashboard."}</p>
        <Link href="/dashboard" className="btn-primary mt-6">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
