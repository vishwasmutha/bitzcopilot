"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, Field, Input } from "@/components/ui";
import { Logo } from "../../page";
import { goSignedIn } from "@/lib/client-auth";

function LoginForm() {
  const params = useSearchParams();
  const sessionError = params.get("error") === "session";
  const [mode, setMode] = useState<"b" | "a">("b");
  const [phone, setPhone] = useState("9845012345");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(
    sessionError ? "The last sign-in didn't stick. Use Option B again — we'll attach the session on the next page." : null
  );
  const [busy, setBusy] = useState(false);

  const finish = (token?: string) => {
    if (!token) {
      setError("Not authenticated — the server didn't return a session. Please try Option B again.");
      return;
    }
    goSignedIn(token, "/dashboard");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(mode === "b" ? "/api/auth/phone" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(mode === "b" ? { phone, password } : { email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Not authenticated");
        return;
      }
      finish(j.token);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/demo", { method: "POST", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) {
        setError(j.error ?? "Not authenticated — demo sign-in did not return a session.");
        return;
      }
      finish(j.token);
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
        <h1 className="font-display text-lg font-semibold">Sign in where you already are</h1>
        <p className="mt-1 text-sm text-slate-500">Option B is the WhatsApp number. That&apos;s the one shop owners actually use.</p>
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm">
          <button type="button" onClick={() => setMode("a")} className={"rounded-full px-2 py-2 font-medium " + (mode === "a" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
            A · Email
          </button>
          <button type="button" onClick={() => setMode("b")} className={"rounded-full px-2 py-2 font-medium " + (mode === "b" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
            B · WhatsApp
          </button>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "b" ? (
            <Field label="WhatsApp number" hint="Demo kirana: 98450 12345 · PIN demo1234">
              <Input inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" />
            </Field>
          ) : (
            <Field label="Email" hint="Demo also works: demo@bizcopilot.app">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
            </Field>
          )}
          <Field label={mode === "b" ? "PIN" : "Password"}>
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "b" ? "demo1234" : "••••••••"} />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
          <Button type="submit" loading={busy} className={"w-full " + ""}>
            {mode === "b" ? "Open WhatsApp" : "Sign in"}
          </Button>
        </form>
        <button type="button" onClick={demo} className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600">
          Or open the Jayanagar demo shop in one tap
        </button>
        <p className="mt-4 text-center text-sm text-slate-500">
          New shop?{" "}
          <Link href="/signup" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
