"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { Logo } from "../../page";

export default function ForgotPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Could not generate a reset code.");
      setNote(j.message ?? "");
      if (j.token) {
        setToken(j.token);
        setStep(2);
      }
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Reset failed.");
      router.push("/login");
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
        {step === 1 ? (
          <>
            <h1 className="font-display text-lg font-semibold">Reset your password</h1>
            <p className="mt-1 text-sm text-slate-500">Enter your account email and we&apos;ll generate a reset code.</p>
            <form onSubmit={requestCode} className="mt-6 space-y-4">
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
              <Button type="submit" loading={busy} className="w-full">
                Generate reset code
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="font-display text-lg font-semibold">Choose a new password</h1>
            <p className="mt-1 text-sm text-slate-500">{note}</p>
            <form onSubmit={doReset} className="mt-6 space-y-4">
              <Field label="Reset code">
                <Input required value={token} onChange={(e) => setToken(e.target.value)} />
              </Field>
              <Field label="New password" hint="At least 8 characters.">
                <Input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
              <Button type="submit" loading={busy} className="w-full">
                Update password
              </Button>
            </form>
          </>
        )}
        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
