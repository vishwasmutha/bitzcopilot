"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Filter } from "lucide-react";
import { Badge, Card, Field, Input, Spinner } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type Preview = { total: number; consented: number; withPhone: number; rule: string; sample: { refId: string; name: string | null; consent: boolean; orders: number; spent: number; recencyDays: number | null }[] };

const PRESETS: { label: string; spec: Record<string, string> }[] = [
  { label: "Regulars gone quiet", spec: { minOrders: "2", notBoughtForDays: "30" } },
  { label: "Big spenders", spec: { minSpend: "5000" } },
  { label: "Bought once", spec: { maxOrders: "1" } },
  { label: "Active this month", spec: { boughtWithinDays: "30" } },
];

/** Build your own segment by rule. Shows who is in it and how many agreed to be messaged. */
export function SegmentBuilder() {
  const [spec, setSpec] = useState<Record<string, string>>({ minOrders: "2", notBoughtForDays: "30" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clean = Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== "" && Number(v) >= 0));
  const key = JSON.stringify(clean);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      authFetch(`/api/audience?segment=Custom%20segment&spec=${encodeURIComponent(key)}`)
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not size that segment.");
          setPreview(j);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [key]);

  const field = (k: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input id={`seg-${k}`} type="number" min={0} inputMode="numeric" value={spec[k] ?? ""} onChange={(e) => setSpec({ ...spec, [k]: e.target.value })} placeholder="any" />
    </Field>
  );

  return (
    <Card title="Segment builder" sub="Pick the customers you want by rule. You see how many there are and how many agreed to be messaged.">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setSpec(p.spec)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {field("minOrders", "At least this many orders")}
        {field("maxOrders", "At most this many orders")}
        {field("boughtWithinDays", "Bought in the last N days")}
        {field("notBoughtForDays", "No purchase for N+ days")}
        {field("minSpend", "Spent at least ₹")}
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-800" aria-live="polite">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !preview ? (
          <Spinner />
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="font-display text-2xl font-bold tabular-nums">{preview.total}</p>
              <p className="text-xs text-slate-500">customers match{loading ? "…" : ""}</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{preview.consented}</p>
              <p className="text-xs text-slate-500">agreed to be messaged</p>
            </div>
            <div className="min-w-0 flex-1 text-xs text-slate-500">
              {preview.sample.length > 0 ? (
                <p className="truncate">
                  e.g. {preview.sample.map((s) => s.name ?? s.refId).join(", ")}
                  {preview.total > preview.sample.length ? "…" : ""}
                </p>
              ) : (
                <p>Nobody matches. Loosen a rule.</p>
              )}
              <p className="mt-0.5 text-slate-400">Rule: {preview.rule}</p>
            </div>
            {preview.consented > 0 ? (
              <Link href={`/marketing?type=whatsapp&segment=Custom%20segment&spec=${encodeURIComponent(key)}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:gap-2.5 dark:text-brand-300" style={{ transition: "gap .15s" }}>
                Draft a message <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Badge tone="warning"><Filter className="h-3 w-3" /> No one here has agreed to be messaged</Badge>
            )}
          </div>
        )}
        {preview && preview.sample.length > 0 && (
          <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800">
            Sample spend: {preview.sample.map((s) => fmtCurrency(s.spent, true)).join(", ")}
          </p>
        )}
      </div>
    </Card>
  );
}
