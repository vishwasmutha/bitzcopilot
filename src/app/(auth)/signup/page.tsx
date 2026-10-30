"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { Logo } from "../../page";
import { goSignedIn } from "@/lib/client-auth";

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Registration failed.");
      if (!j.token) return setError("Account created but the session was not issued. Sign in with Option B.");
      goSignedIn(j.token, "/onboarding");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white p-2.5 shadow-sm"><Logo className="h-full w-full" /></span>
        <span className="text-xl font-semibold tracking-tight">BizCopilot</span>
      </div>
      <div className="bc-fade-up w-full max-w-sm rounded-3xl bg-white p-8 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.4)]">
        <h1 className="font-display text-lg font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Free forever for one business workspace.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Your name">
            <Input required value={form.name} onChange={set("name")} placeholder="Alex Morgan" />
          </Field>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={set("email")} placeholder="you@business.com" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input type="password" required value={form.password} onChange={set("password")} placeholder="••••••••" />
          </Field>
          <Field label="Confirm password">
            <Input type="password" required value={form.confirm} onChange={set("confirm")} placeholder="••••••••" />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
          <Button type="submit" loading={busy} className="w-full">
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
