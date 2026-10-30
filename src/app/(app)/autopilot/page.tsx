"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCheck, Copy, PackageCheck, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Spinner, useToast } from "@/components/ui";
import { DailyOperator } from "@/components/daily-operator";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type Level = 1 | 2 | 3;
type State = { level: Level; budget: number; spentThisWeek: number; remaining: number };
type LevelInfo = { level: Level; name: string; blurb: string };
type Row = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  why: string | null;
  level: number;
  status: string;
  amount: number | null;
  payload: { lines?: { name: string; qty: number; cashOut: number }[]; segment?: string; product?: string } | null;
  createdAt: string;
  decidedAt: string | null;
};

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "info" | "error" }> = {
  suggested: { label: "Suggested", tone: "info" },
  drafted: { label: "Draft, waiting for you", tone: "warning" },
  auto_approved: { label: "Approved automatically", tone: "success" },
  approved: { label: "Approved by you", tone: "success" },
  received: { label: "Received", tone: "neutral" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

const KIND: Record<string, string> = { purchase_order: "Purchase order", promo_draft: "Promotion draft", winback_draft: "Win-back draft", cash_warning: "Cash warning" };

function supplierMessage(r: Row): string {
  const lines = (r.payload?.lines ?? []).map((l) => `${l.qty} x ${l.name}`).join("\n");
  return `Hello, please send:\n${lines}\n\nThank you.`;
}

export default function AutopilotPage() {
  const { push } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [log, setLog] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>(2);
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const apply = useCallback((j: { state: State; levels?: LevelInfo[]; log: Row[] }) => {
    setState(j.state);
    if (j.levels) setLevels(j.levels);
    setLog(j.log);
    setLevel(j.state.level);
    setBudget((b) => (b === "" ? String(j.state.budget || "") : b));
  }, []);

  const load = useCallback(
    () =>
      authFetch("/api/autopilot")
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not load.");
          apply(j);
        })
        .catch((e: Error) => setError(e.message)),
    [apply]
  );
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await authFetch("/api/autopilot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level, budget: Number(budget) || 0 }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not save", desc: j.error, tone: "error" });
      push({ title: "Autopilot updated", tone: "success" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      const r = await authFetch("/api/autopilot", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not run", desc: j.error, tone: "error" });
      apply(j);
      push({ title: j.created ? `${j.created} new item${j.created === 1 ? "" : "s"} logged` : "Nothing new today", tone: j.created ? "success" : "info" });
    } finally {
      setRunning(false);
    }
  };

  const decide = async (id: string, decision: "approve" | "dismiss" | "received") => {
    const r = await authFetch(`/api/autopilot/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return push({ title: "Could not update", desc: j.error, tone: "error" });
    if (decision === "received") push({ title: "Stock added", desc: "The delivered quantities were added to your inventory.", tone: "success" });
    load();
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      push({ title: "Copy failed", desc: "Select the text and copy it by hand.", tone: "error" });
    }
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">{error}</p>;
  if (!state || !log) return <Spinner label="Loading autopilot…" />;

  const dirty = level !== state.level || (level === 3 && Number(budget) !== state.budget);
  const pct = state.budget > 0 ? Math.min(100, (state.spentThisWeek / state.budget) * 100) : 0;

  return (
    <div className="bc-fade-up space-y-6">
      <PageHeader
        title="Autopilot"
        desc="You choose how much BizCopilot does. Every suggestion and action is logged with the reason, so nothing happens that you cannot see."
        actions={
          <Button variant="outline" size="sm" onClick={run} loading={running}>
            <RefreshCw className="h-3.5 w-3.5" /> Check the shop now
          </Button>
        }
      />

      <DailyOperator onRan={load} />

      <Card title="How much should it do?" sub="Change this any time. It applies from the next check.">
        <div role="radiogroup" aria-label="Autopilot level" className="grid gap-3 md:grid-cols-3">
          {levels.map((l) => (
            <button
              key={l.level}
              type="button"
              role="radio"
              aria-checked={level === l.level}
              onClick={() => setLevel(l.level)}
              className={
                "rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 " +
                (level === l.level ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50")
              }
            >
              <div className="flex items-center gap-2">
                <span className={"flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold " + (level === l.level ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-400")}>{l.level}</span>
                <span className="font-display text-sm font-semibold">{l.name}</span>
              </div>
              <p className="mt-1.5 text-xs leading-snug text-slate-600 dark:text-slate-300">{l.blurb}</p>
            </button>
          ))}
        </div>
        {level === 3 && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-end">
            <Field label="Weekly budget in ₹" hint="It will approve purchase orders on its own up to this amount each week.">
              <Input id="autopilot-budget" type="number" inputMode="decimal" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 25000" />
            </Field>
            {state.level === 3 && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>Used this week</span>
                  <span className="tabular-nums">
                    {fmtCurrency(state.spentThisWeek)} of {fmtCurrency(state.budget)}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(pct, state.spentThisWeek > 0 ? 2 : 0)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={save} loading={saving} disabled={!dirty || saving || (level === 3 && !(Number(budget) > 0))}>
            <Check className="h-4 w-4" /> Save
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Messages to customers are never sent automatically, and only customers who agreed to be messaged are ever included.
          </p>
        </div>
      </Card>

      <Card title="Action log" sub="Newest first. Each entry says what was done or proposed, and why." pad={false}>
        {log.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Nothing logged yet. Press “Check the shop now” and BizCopilot will look at stock, sales, cash and customers.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {log.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
              const waiting = r.status === "suggested" || r.status === "drafted";
              const isPo = r.kind === "purchase_order";
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <Badge tone="neutral">{KIND[r.kind] ?? r.kind}</Badge>
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.createdAt).toLocaleDateString()} · level {r.level}
                    </span>
                  </div>
                  <p className="font-display mt-2 text-base font-semibold">{r.title}</p>
                  {r.detail && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{r.detail}</p>}
                  {isPo && r.payload?.lines && (
                    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                      {r.payload.lines.map((l) => (
                        <li key={l.name} className="flex justify-between gap-3 px-3 py-1.5">
                          <span className="min-w-0 truncate">{l.qty} × {l.name}</span>
                          <span className="tabular-nums text-slate-500">{fmtCurrency(l.cashOut)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" aria-expanded={open === r.id}>
                    {open === r.id ? "Hide the reason" : "Why was this done?"}
                  </button>
                  {open === r.id && r.why && <p className="mt-1.5 rounded-md bg-slate-50 p-2.5 text-xs leading-snug text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{r.why}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {waiting && r.kind !== "cash_warning" && (
                      <Button size="sm" onClick={() => decide(r.id, "approve")}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                    )}
                    {waiting && (
                      <Button size="sm" variant="ghost" onClick={() => decide(r.id, "dismiss")}>
                        <X className="h-3.5 w-3.5" /> Dismiss
                      </Button>
                    )}
                    {isPo && (r.status === "approved" || r.status === "auto_approved") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => copy(r.id, supplierMessage(r))}>
                          {copied === r.id ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy supplier message
                        </Button>
                        <Button size="sm" onClick={() => decide(r.id, "received")}>
                          <PackageCheck className="h-3.5 w-3.5" /> Mark received
                        </Button>
                      </>
                    )}
                    {r.kind === "cash_warning" && (
                      <Link href="/cash" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">Open the cash outlook</Link>
                    )}
                    {(r.kind === "winback_draft" || r.kind === "promo_draft") && !["dismissed", "received"].includes(r.status) && (
                      <Link
                        href={r.kind === "winback_draft" ? "/marketing?type=whatsapp&segment=At-risk%20customers" : `/marketing?type=whatsapp&product=${encodeURIComponent(r.payload?.product ?? "")}`}
                        className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                      >
                        Open in the Marketing Studio
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
