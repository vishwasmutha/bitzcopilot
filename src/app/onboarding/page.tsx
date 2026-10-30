"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Cake, Coffee, Leaf, Scissors, Shirt, ShoppingBag, Store, Wrench } from "lucide-react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { Logo } from "../page";
import { BUSINESS_SIZES, CATEGORY_OPTIONS } from "@/lib/utils";

const CAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Kirana: Store,
  Salon: Scissors,
  Bakery: Cake,
  Restaurant: Coffee,
  "Grocery Store": Leaf,
  "Retail Store": ShoppingBag,
  "Clothing Store": Shirt,
  "Local Services": Wrench,
  Other: Store,
};

export default function OnboardingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Kirana");
  const [location, setLocation] = useState("");
  const [size, setSize] = useState<string>("Small (5-20)");
  const [employees, setEmployees] = useState("4");
  const [wantDemo, setWantDemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/business/profile")
      .then((r) => r.json())
      .then((j) => {
        if (j.business) router.replace("/dashboard");
        else setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, location, size, employees: Number(employees) || 0 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Could not save your business profile.");
      if (wantDemo) {
        await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "load", category }),
        });
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /> Checking your workspace…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="font-display text-xl font-bold tracking-tight">BizCopilot</span>
          <Badge tone="info">Step 2 of 2 — your business</Badge>
        </div>
        <div className="bc-fade-up rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-xl font-bold">Set up your business</h1>
          <p className="mt-1 text-sm text-slate-500">
            BizCopilot personalises analytics, forecasts and marketing around the type of business you run.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-5">
            <Field label="Business name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Sweet Corner Bakery" />
            </Field>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Business category</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORY_OPTIONS.map((c) => {
                  const Icon = CAT_ICONS[c] ?? Store;
                  const active = category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={
                        "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-[13px] font-medium transition-all " +
                        (active
                          ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300"
                          : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800")
                      }
                    >
                      <Icon className="h-5 w-5" />
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Portland, OR" />
              </Field>
              <Field label="Employees">
                <Input type="number" min={1} max={500} value={employees} onChange={(e) => setEmployees(e.target.value)} />
              </Field>
            </div>
            <Field label="Business size">
              <Select value={size} onChange={(e) => setSize(e.target.value)}>
                {BUSINESS_SIZES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
              <input type="checkbox" checked={wantDemo} onChange={(e) => setWantDemo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
              <span className="text-[13px] text-amber-800 dark:text-amber-300">
                <strong>Load a realistic demo dataset</strong> (120 days of sales, products and customers for a {category.toLowerCase()}).
                It&apos;s clearly labelled as demo data, fully separated from your own data, and can be reset any time in Settings.
              </span>
            </label>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
            <Button type="submit" size="lg" loading={busy} className="w-full">
              Open my dashboard
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
