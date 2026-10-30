"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, MessageCircle, Play } from "lucide-react";
import { Badge, Button, Card, Select, Spinner, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { LANG_OPTIONS, fmtCurrency } from "@/lib/utils";

type Run = {
  date: string;
  ranAt: string;
  alreadyRan: boolean;
  lang: string;
  newActions: number;
  collections?: { drafted: number; overdueCount: number; overdueTotal: number };
  actions: { title: string; atStake: number | null }[];
  brief: string;
  delivery: { channel: "whatsapp" | "in-app"; status: "sent" | "not_configured" | "no_phone" | "failed"; note: string };
};

const DELIVERY: Record<Run["delivery"]["status"], { label: string; tone: "success" | "neutral" | "warning" | "error" }> = {
  sent: { label: "Sent on WhatsApp", tone: "success" },
  not_configured: { label: "Saved in the app", tone: "neutral" },
  no_phone: { label: "Saved in the app", tone: "neutral" },
  failed: { label: "WhatsApp failed, saved in the app", tone: "warning" },
};

export function DailyOperator({ onRan }: { onRan?: () => void }) {
  const { push } = useToast();
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  const [lang, setLang] = useState("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/operator");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRun(j.run ?? null);
      if (j.run?.lang) setLang(j.run.lang);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the daily check.");
      setRun(null);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch("/api/operator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true, lang }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The daily check could not run.");
      setRun(j.run);
      push({ title: "Daily check finished", desc: `${j.run.actions.length} priorities found. ${j.run.delivery.note}`, tone: "success" });
      onRan?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The daily check could not run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Daily operator"
      sub="Checks sales, stock and cash every morning, writes your brief and delivers it. It never messages customers."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={lang} onChange={(e) => setLang(e.target.value)} className="h-10 w-auto" aria-label="Brief language">
            {LANG_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
          <Button onClick={runNow} loading={busy}>
            <Play className="h-4 w-4" /> Run now
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand-600" /> Scheduled daily at 9:00 AM IST
        </span>
        {run && (
          <>
            <span>Last run {new Date(run.ranAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
            <Badge tone={DELIVERY[run.delivery.status].tone}>
              {run.delivery.channel === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              {DELIVERY[run.delivery.status].label}
            </Badge>
          </>
        )}
      </div>

      {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {run === undefined ? (
        <Spinner label="Loading…" />
      ) : run === null ? (
        <p className="mt-5 rounded-2xl bg-slate-100 px-5 py-4 text-[15px] text-slate-600">It has not run yet today. Press Run now to see exactly what it does, or let the schedule do it.</p>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Priorities it found</p>
            {run.actions.length === 0 ? (
              <p className="mt-2 text-[15px] text-slate-600">Nothing urgent. No drop, stock-out or cash shortfall in your data.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {run.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium leading-6 text-slate-900">{a.title}</p>
                      {a.atStake != null && <p className="text-sm text-slate-500">{fmtCurrency(a.atStake, true)} at stake</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {run.collections && run.collections.overdueCount > 0 && (
              <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-slate-800">
                <span className="font-semibold">Collections:</span> {fmtCurrency(run.collections.overdueTotal, true)} overdue from {run.collections.overdueCount} customer{run.collections.overdueCount === 1 ? "" : "s"}.{" "}
                {run.collections.drafted > 0 ? `${run.collections.drafted} reminder${run.collections.drafted === 1 ? "" : "s"} drafted for you to send on the Cash page.` : "No new reminders today (each customer gets at most one per stage, spaced apart)."}
              </p>
            )}
            <p className="mt-4 text-sm text-slate-500">
              {run.newActions > 0 ? `${run.newActions} new item${run.newActions === 1 ? "" : "s"} added to the action log below.` : "No new items for the action log."} {run.delivery.note}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">The brief it wrote</p>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-100 p-4 font-sans text-[15px] leading-7 text-slate-800">{run.brief}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
