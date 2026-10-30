"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, FlaskConical, LogOut, Save, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Select, useToast } from "@/components/ui";
import { BUSINESS_SIZES, CATEGORY_OPTIONS } from "@/lib/utils";
import { clearToken } from "@/lib/client-auth";

type Biz = { id: string; name: string; category: string; location: string | null; size: string | null; employees: number | null; isDemo: boolean };

export default function SettingsPage() {
  const { push } = useToast();
  const router = useRouter();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [hasDemo, setHasDemo] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/business/profile").then((r) => r.json()).then((j) => setBiz(j.business ?? null)).catch(() => {});
    fetch("/api/ai/status").then((r) => r.json()).then((j) => setProvider(j.provider ?? "builtin")).catch(() => setProvider("builtin"));
    fetch("/api/demo").then((r) => r.json()).then((j) => setHasDemo(j.hasDemoData ?? false)).catch(() => {});
  }, []);

  const saveProfile = async () => {
    if (!biz) return;
    setBusy("profile");
    try {
      const r = await fetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(biz),
      });
      const j = await r.json();
      if (r.ok) push({ title: "Business profile saved", tone: "success" });
      else push({ title: "Save failed", desc: j.error, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const demoAction = async (action: "load" | "clear") => {
    setBusy("demo");
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, category: biz?.category }),
      });
      const j = await r.json();
      if (r.ok) {
        push({ title: action === "load" ? "Demo dataset loaded" : "Demo data cleared", desc: j.message, tone: "success" });
        setHasDemo(action === "load");
        router.refresh();
      } else push({ title: "Action failed", desc: j.error, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clearToken();
    router.push("/login");
    router.refresh();
  };

  if (!biz) {
    return <div className="py-20 text-center text-sm text-slate-400">Loading settings…</div>;
  }

  return (
    <div className="bc-fade-up mx-auto max-w-2xl space-y-4">
      <PageHeader title="Settings" desc="Your business profile, AI engine status and demo data controls." />

      <Card title="Business profile" sub="Used to personalise analytics, forecasts and marketing copy">
        <div className="space-y-4">
          <Field label="Business name">
            <Input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={biz.category} onChange={(e) => setBiz({ ...biz, category: e.target.value })}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Location">
              <Input value={biz.location ?? ""} onChange={(e) => setBiz({ ...biz, location: e.target.value })} />
            </Field>
            <Field label="Size">
              <Select value={biz.size ?? BUSINESS_SIZES[1]} onChange={(e) => setBiz({ ...biz, size: e.target.value })}>
                {BUSINESS_SIZES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Employees">
              <Input type="number" min={0} value={biz.employees ?? 0} onChange={(e) => setBiz({ ...biz, employees: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} loading={busy === "profile"}>
              <Save className="h-4 w-4" /> Save profile
            </Button>
          </div>
        </div>
      </Card>

      <Card title="AI engine" sub="How the assistant and marketing generator answer">
        <div className="flex items-center gap-3">
          <span className={"flex h-10 w-10 items-center justify-center rounded-xl " + (provider === "builtin" ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400")}>
            <BrainCircuit className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {provider === "openai" ? "OpenAI (gpt-4o-mini)" : provider === "gemini" ? "Google Gemini (2.0 Flash)" : "Built-in grounded engine"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {provider === "builtin"
                ? "No OPENAI_API_KEY or GEMINI_API_KEY is configured on the server, so BizCopilot uses its built-in engine. Every figure still comes from your database — nothing is invented. Add a key in .env to enable full LLM prose."
                : "External LLM enabled — responses are grounded in your data via a strict no-invented-numbers system prompt."}
            </p>
          </div>
          <Badge tone={provider === "builtin" ? "warning" : "success"}>{provider === "builtin" ? "fallback" : "live"}</Badge>
        </div>
      </Card>

      <Card title="Demo dataset" sub="Labelled sample data for exploration — isolated from your real records">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <FlaskConical className="h-4 w-4 text-amber-500" />
            {hasDemo === null ? "Checking…" : hasDemo ? "Demo data is currently loaded and flagged." : "No demo data in this workspace."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => demoAction("load")} loading={busy === "demo"} disabled={hasDemo === null || hasDemo}>
              <Upload className="h-4 w-4" /> Load demo
            </Button>
            <Button variant="danger" onClick={() => demoAction("clear")} loading={busy === "demo"} disabled={hasDemo === null || !hasDemo}>
              <Trash2 className="h-4 w-4" /> Reset demo data
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Session">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">Sign out of BizCopilot on this device.</p>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
