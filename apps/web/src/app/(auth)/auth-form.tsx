"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { login, register, type AuthState } from "./actions";

export function AuthForm({ mode, next, google, oauthError }: { mode: "login" | "register"; next?: string; google?: boolean; oauthError?: boolean }) {
  const action = mode === "login" ? login : register;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);
  const fe = state?.fieldErrors ?? {};
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/register" className="text-fg underline underline-offset-4">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have one?{" "}
              <Link href="/login" className="text-fg underline underline-offset-4">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>

      {oauthError && (
        <div role="alert" className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-fg">
          Google sign-in did not complete. Try again or use email.
        </div>
      )}
      {state?.error && (
        <div role="alert" className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-fg">
          {state.error}
        </div>
      )}

      {mode === "register" && (
        <div>
          <label htmlFor="name" className="label">
            Name
          </label>
          <input id="name" name="name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} className="input" aria-invalid={!!fe.name} />
          {fe.name && <p className="error">{fe.name}</p>}
        </div>
      )}
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" aria-invalid={!!fe.email} />
        {fe.email && <p className="error">{fe.email}</p>}
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? 8 : undefined}
          className="input"
          aria-invalid={!!fe.password}
        />
        {mode === "register" && !fe.password && <p className="help">At least 8 characters.</p>}
        {fe.password && <p className="error">{fe.password}</p>}
      </div>

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "One moment" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      {google && (
        <a href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn-secondary w-full">
          Continue with Google
        </a>
      )}
    </form>
  );
}
