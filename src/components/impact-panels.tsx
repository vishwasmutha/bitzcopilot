"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BadgeIndianRupee, Boxes, CalendarClock, HandCoins, HeartHandshake, PackageMinus, Repeat2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { BenchmarkReport, LiftReport, Scorecard, TodayAction } from "@/lib/impact";
import type { ExperimentReport } from "@/lib/experiments";
import type { DropReport } from "@/lib/impact-math";
import { Badge, Card, EmptyState, Spinner } from "./ui";
import { MathReceipt, type ReceiptData } from "./receipt";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency, fmtPercent, type Lang } from "@/lib/utils";

export type ImpactData = { actions: TodayAction[]; drop: DropReport; lifts: LiftReport[]; experiments: ExperimentReport[]; benchmarks: BenchmarkReport; scorecard: Scorecard };

export function useImpact(opts: { lang?: Lang; limit?: number } = {}) {
  const { lang = "en", limit = 3 } = opts;
  const [data, setData] = useState<ImpactData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchImpact = useCallback(
    () =>
      authFetch(`/api/impact?lang=${lang}&limit=${limit}`)
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not load.");
          setData(j);
        })
        .catch((e: Error) => setError(e.message)),
    [lang, limit]
  );
  useEffect(() => {
    fetchImpact();
  }, [fetchImpact]);
  const reload = useCallback(() => {
    setError(null);
    fetchImpact();
  }, [fetchImpact]);
  return { data, error, reload };
}

const KIND_ICON = {
  drop: TrendingDown,
  stock: PackageMinus,
  winback: HeartHandshake,
  repeat: Repeat2,
  festival: CalendarClock,
  cash: Wallet,
  slow: Boxes,
  collect: HandCoins,
} as const;

/* ------------------------------------------------------------------ */
/* Today's actions                                                      */
/* ------------------------------------------------------------------ */

export function ActionList({ actions }: { actions: TodayAction[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!actions.length) {
    return (
      <EmptyState
        icon={<BadgeIndianRupee className="h-5 w-5" />}
        title="Nothing urgent today"
        desc="No sales drop, stock-out, cash shortfall or lapsing regulars were found in your data. Check back tomorrow or load more history."
      />
    );
  }
  return (
    <ol className="grid gap-3 rounded-3xl bg-navy-900 p-3 sm:p-4 lg:grid-cols-3">
      {actions.map((a, i) => {
        const Icon = KIND_ICON[a.kind];
        return (
          <li key={a.id} className="flex flex-col rounded-2xl bg-white/[0.07] p-4 text-white">
            <div className="flex items-center gap-2">
              <span className="font-display flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-label={`Priority ${i + 1}`}>
                {i + 1}
              </span>
              <Icon className="h-4 w-4 text-slate-300" />
              {a.atStake != null ? (
                <Badge tone="warning" className="ml-auto !bg-white/10 !text-brand-300 !ring-white/15">{fmtCurrency(a.atStake, true)} at stake</Badge>
              ) : (
                <Badge tone="neutral" className="ml-auto !bg-white/10 !text-slate-200 !ring-white/15">Seasonal prior</Badge>
              )}
            </div>
            <h3 className="font-display mt-3 text-base font-semibold leading-snug text-white">{a.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{a.detail}</p>
            <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="mt-2 w-fit text-xs font-medium text-brand-300 hover:underline" aria-expanded={open === a.id}>
              {open === a.id ? "Hide how this was worked out" : "How was this worked out?"}
            </button>
            {open === a.id && <p className="mt-1.5 rounded-lg bg-white/10 p-2.5 text-xs leading-snug text-slate-200">{a.why}</p>}
            <Link href={a.cta.href} className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-brand-300 hover:gap-2.5" style={{ transition: "gap .15s" }}>
              {a.cta.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Self-contained version for the dashboard. */
export function TodayActionsCard() {
  const { data, error } = useImpact();
  return (
    <section aria-labelledby="today-actions">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="today-actions" className="font-display text-base font-semibold text-slate-900 dark:text-white">Today&apos;s 3 actions</h2>
        <Link href="/impact" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">Everything behind these</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p> : !data ? <Spinner label="Working out your priorities…" /> : <ActionList actions={data.actions} />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Holdout experiments: the strongest evidence a promotion worked        */
/* ------------------------------------------------------------------ */

const XV = {
  worked: { tone: "success" as const, label: "Worked" },
  inconclusive: { tone: "neutral" as const, label: "Can't tell yet" },
  worse: { tone: "error" as const, label: "Did worse than not messaging" },
};

export function ExperimentsPanel({ experiments, onChange }: { experiments: ExperimentReport[]; onChange?: () => void }) {
  return (
    <Card title="Did the promotion work? Tested against a held-back group" sub="A random share of each segment is deliberately not messaged. The gap between the two groups is what the message caused.">
      {!experiments.length ? (
        <p className="py-6 text-center text-sm text-slate-400">
          No tests yet. In the <Link href="/marketing" className="font-medium text-brand-700 underline dark:text-brand-300">Marketing Studio</Link>, draft a message for a customer segment and press “Start tracked send”. You message only the chosen customers; the rest are the control group.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {experiments.map((e) => (
            <ExperimentRow key={e.id} e={e} onChange={onChange} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExperimentRow({ e, onChange }: { e: ExperimentReport; onChange?: () => void }) {
  const r = e.result;
  const [confirm, setConfirm] = useState(false);
  const remove = async () => {
    await authFetch(`/api/experiments?id=${e.id}`, { method: "DELETE" });
    setConfirm(false);
    onChange?.();
  };
  let receipt: ReceiptData | null = null;
  if (r.status === "ok") receipt = { title: e.title, status: "computed", headline: `${fmtCurrency(r.incrementalTotal)} extra from ${r.nT} messaged customers`, steps: r.steps, caveat: "Customers were split at random, so the held-back group shows what would have happened anyway. Small groups give wide ranges." };
  else if (r.status === "insufficient") receipt = { title: e.title, status: "insufficient", headline: "Not enough customers", steps: [{ label: "Why", detail: r.why }] };
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{e.title}</p>
        <Badge tone="neutral">{e.segment}</Badge>
        <span className="ml-auto text-xs text-slate-400">
          Sent {e.startedOn} · day {e.daysElapsed} of {e.windowDays}
        </span>
      </div>
      {r.status === "measuring" && <p className="mt-2 text-xs text-slate-500">Too early. Needs {r.needed} days of sales after sending; {r.daysElapsed} so far. {e.messaged} messaged, {e.heldBack} held back.</p>}
      {r.status === "insufficient" && <p className="mt-2 text-xs text-slate-500">{r.why}</p>}
      {r.status === "ok" && (
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1.4fr] sm:items-center">
          <div>
            <p className={"font-display text-2xl font-bold tracking-tight " + (r.verdict === "worked" ? "text-emerald-600 dark:text-emerald-400" : r.verdict === "worse" ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-200")}>
              {r.incrementalTotal >= 0 ? "+" : "−"}
              {fmtCurrency(Math.abs(r.incrementalTotal))}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={XV[r.verdict].tone}>{XV[r.verdict].label}</Badge>
              {r.partial && <Badge tone="info">Still running</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Likely between {fmtCurrency(r.totalLow)} and {fmtCurrency(r.totalHigh)} (95%)
            </p>
          </div>
          <div className="space-y-2" role="img" aria-label={`${Math.round(r.rateT * 100)} percent of messaged customers came back, against ${Math.round(r.rateH * 100)} percent of held-back customers`}>
            {[
              { label: `Messaged (${r.nT})`, value: r.rateT, cls: "bg-brand-500" },
              { label: `Held back (${r.nH})`, value: r.rateH, cls: "bg-slate-400 dark:bg-slate-500" },
            ].map((b) => (
              <div key={b.label}>
                <div className="mb-0.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{b.label} came back</span>
                  <span className="tabular-nums">{Math.round(b.value * 100)}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={"h-full rounded-full " + b.cls} style={{ width: `${Math.max(2, b.value * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {receipt && <MathReceipt receipt={receipt} />}
      <div className="mt-2 text-right text-xs">
        {confirm ? (
          <span className="text-slate-500">
            Remove this test and its groups?{" "}
            <button type="button" onClick={remove} className="font-semibold text-red-600 hover:underline">Remove</button> ·{" "}
            <button type="button" onClick={() => setConfirm(false)} className="hover:underline">Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="text-slate-400 hover:text-red-600 hover:underline">Remove test</button>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Product promo lift (before and after, no control group)               */
/* ------------------------------------------------------------------ */

const VERDICT = {
  lift: { tone: "success" as const, label: "Worked" },
  inconclusive: { tone: "neutral" as const, label: "Can't tell yet" },
  below: { tone: "error" as const, label: "Sold less than normal" },
};

export function LiftPanel({ lifts }: { lifts: LiftReport[] }) {
  return (
    <Card title="Product offers: sales before and after" sub="An estimate for offers sent to everyone, so there is no held-back group. Sales after sending, against what the same product would have sold anyway.">
      {!lifts.length ? (
        <p className="py-6 text-center text-sm text-slate-400">
          No tracked offers yet. In the <Link href="/marketing" className="font-medium text-brand-700 underline dark:text-brand-300">Marketing Studio</Link>, save an offer for one product and press “I sent this”. After 3 days this page shows what it added.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {lifts.map((l) => (
            <LiftRow key={l.campaignId} l={l} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LiftRow({ l }: { l: LiftReport }) {
  const r = l.result;
  let receipt: ReceiptData | null = null;
  if (r.status === "measured") {
    receipt = { title: l.title, status: "computed", headline: `${l.product}: ${fmtCurrency(r.incremental)} ${r.incremental >= 0 ? "above" : "below"} what was expected`, steps: r.steps, caveat: "This compares your own sales before and after. It cannot prove the offer was the only cause. A held-back group is the stronger test." };
  } else if (r.status === "insufficient") {
    receipt = { title: l.title, status: "insufficient", headline: "Not enough history", steps: [{ label: "Why", detail: r.why }] };
  }
  const max = r.status === "measured" ? Math.max(r.actual, r.expected, 1) : 1;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{l.title}</p>
        {l.product && <Badge tone="neutral">{l.product}</Badge>}
        {l.discount ? <Badge tone="neutral">{l.discount}% off</Badge> : null}
        <span className="ml-auto text-xs text-slate-400">Sent {l.startedOn}</span>
      </div>
      {r.status === "no-product" && <p className="mt-2 text-xs text-slate-500">This offer was not tied to one product, so its effect cannot be isolated.</p>}
      {r.status === "measuring" && <p className="mt-2 text-xs text-slate-500">Too early. Needs {r.needed} days of sales after sending; {r.daysElapsed} so far.</p>}
      {r.status === "insufficient" && <p className="mt-2 text-xs text-slate-500">{r.why}</p>}
      {r.status === "measured" && (
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_1.4fr] sm:items-center">
          <div>
            <p className={"font-display text-2xl font-bold tracking-tight " + (r.verdict === "lift" ? "text-emerald-600 dark:text-emerald-400" : r.verdict === "below" ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-200")}>
              {r.incremental >= 0 ? "+" : "−"}
              {fmtCurrency(Math.abs(r.incremental))}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>
              {r.liftPct != null && <span className="text-xs text-slate-500">{fmtPercent(r.liftPct, true)} vs expected</span>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Likely between {fmtCurrency(r.low)} and {fmtCurrency(r.high)} (95%)
            </p>
          </div>
          <div className="space-y-2" role="img" aria-label={`Expected ${fmtCurrency(r.expected)}, actual ${fmtCurrency(r.actual)}`}>
            {[
              { label: "Would have sold", value: r.expected, cls: "bg-slate-300 dark:bg-slate-600" },
              { label: "Actually sold", value: r.actual, cls: r.verdict === "below" ? "bg-red-500" : "bg-brand-500" },
            ].map((b) => (
              <div key={b.label}>
                <div className="mb-0.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{b.label}</span>
                  <span className="tabular-nums">{fmtCurrency(b.value)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={"h-full rounded-full " + b.cls} style={{ width: `${Math.max(2, (b.value / max) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {receipt && <MathReceipt receipt={receipt} />}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Why sales moved                                                      */
/* ------------------------------------------------------------------ */

export function DropPanel({ drop }: { drop: DropReport }) {
  if (drop.status === "insufficient") {
    return (
      <Card title="Why did sales move?" sub="This week against a normal week, product by product">
        <p className="py-6 text-center text-sm text-slate-400">{drop.why}</p>
      </Card>
    );
  }
  const down = drop.delta < 0;
  const maxAbs = Math.max(1, ...drop.drivers.map((d) => Math.abs(d.delta)));
  const receipt: ReceiptData = {
    title: "This week against a normal week",
    status: "computed",
    headline: `${fmtCurrency(drop.currentWeek)} this week vs a normal ${fmtCurrency(drop.baseline)}`,
    steps: [
      { label: "Normal week", detail: `The same 7-day window in each of the last ${drop.baselineWeeks} weeks, averaged. Each window holds every weekday once, so a weekend never skews it.` },
      { label: "Alert rule", detail: `A drop is flagged when this week is about 2 standard deviations (and at least 5%) under normal. Normal weeks varied by ${fmtCurrency(drop.sigma)}; this week is ${drop.zScore != null ? Math.abs(drop.zScore).toFixed(1) : "n/a"} ${drop.zScore != null && drop.zScore < 0 ? "under" : "from"} that.` },
      { label: "Who is responsible", detail: "Each product's gap against its own normal week, divided by the shop's total gap. Categories add their products together." },
    ],
  };
  return (
    <Card
      title="Why did sales move?"
      sub="This week against a normal week, product by product"
      action={drop.dropDetected ? <Badge tone="error">Drop flagged</Badge> : drop.growthDetected ? <Badge tone="success">Unusually strong</Badge> : <Badge tone="neutral">Within normal range</Badge>}
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className={"font-display text-3xl font-bold tracking-tight " + (down ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
            {down ? <TrendingDown className="mr-1.5 inline h-6 w-6" /> : <TrendingUp className="mr-1.5 inline h-6 w-6" />}
            {drop.pct != null ? fmtPercent(drop.pct, true) : "—"}
          </p>
          <p className="text-xs text-slate-500">{fmtCurrency(Math.abs(drop.delta))} {down ? "under" : "over"} a normal week</p>
        </div>
        {drop.worstDay && drop.worstDay.deltaPct != null && drop.worstDay.deltaPct < -5 && (
          <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
            Weakest day: {drop.worstDay.weekday} {drop.worstDay.date.slice(5)}, {fmtCurrency(drop.worstDay.actual)} against a usual {fmtCurrency(drop.worstDay.expected)} ({fmtPercent(drop.worstDay.deltaPct, true)}).
          </p>
        )}
      </div>
      {drop.categories.length > 0 && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          By category: {drop.categories.map((c) => `${c.category} ${c.delta < 0 ? "−" : "+"}${fmtCurrency(Math.abs(c.delta), true)} (${Math.round(c.share)}%)`).join(" · ")}
        </p>
      )}
      {drop.drivers.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {drop.drivers.map((d) => (
            <li key={d.product}>
              <div className="mb-0.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {d.product} <span className="font-normal text-slate-400">· {d.category}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {d.delta < 0 ? "−" : "+"}
                  {fmtCurrency(Math.abs(d.delta))} · {Math.round(d.share)}% of the change
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                <div className={"h-full rounded-full " + (d.delta < 0 ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.max(3, (Math.abs(d.delta) / maxAbs) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <MathReceipt receipt={receipt} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Benchmarks                                                           */
/* ------------------------------------------------------------------ */

export function BenchmarkPanel({ report }: { report: BenchmarkReport }) {
  return (
    <Card title="How you compare" sub={`Usual ranges for a ${report.category.toLowerCase()}`}>
      <ul className="space-y-5">
        {report.rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
              <span className="font-display tabular-nums font-semibold text-slate-900 dark:text-white">{r.value == null ? "—" : `${r.value.toFixed(0)}%`}</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${r.label}: ${r.value == null ? "unknown" : r.value.toFixed(0) + " percent"}, usual range ${r.band[0]} to ${r.band[1]} percent`}>
              <div className="absolute top-0 h-full rounded-full bg-brand-200 dark:bg-brand-500/30" style={{ left: `${r.band[0]}%`, width: `${Math.max(1, r.band[1] - r.band[0])}%` }} />
              {r.value != null && <div className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 ring-2 ring-white dark:bg-white dark:ring-slate-900" style={{ left: `${Math.min(99, Math.max(1, r.value))}%` }} />}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Usual range {r.band[0]}–{r.band[1]}% · {r.read}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-snug text-slate-400 dark:border-slate-800">{report.source}</p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pilot scorecard                                                      */
/* ------------------------------------------------------------------ */

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-display mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-slate-400">{sub}</p>
    </div>
  );
}

export function ScorecardPanel({ s }: { s: Scorecard }) {
  return (
    <Card title="Pilot scorecard" sub="The measures the pilot is judged on. Targets are set after the pilot, so nothing here is a claimed result.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Active days this week" value={`${s.activeDays.days} of ${s.activeDays.of}`} sub="Days you asked a question or acted on a suggestion" />
        <Tile label="Actions taken per insight" value={s.actionsTaken.pct == null ? "—" : `${Math.round(s.actionsTaken.pct)}%`} sub={s.actionsTaken.total ? `${s.actionsTaken.acted} of ${s.actionsTaken.total} logged in 30 days` : "Nothing logged yet"} />
        <Tile label="Stockout rate" value={s.stockout.pct == null ? "—" : `${s.stockout.pct.toFixed(0)}%`} sub={`${s.stockout.out} of ${s.stockout.tracked} products at zero`} />
        <Tile
          label="Came back: messaged vs held back"
          value={s.repeatVsHoldout ? `${Math.round(s.repeatVsHoldout.treatedPct)}% vs ${Math.round(s.repeatVsHoldout.heldPct)}%` : "—"}
          sub={s.repeatVsHoldout ? `${s.repeatVsHoldout.messaged} messaged, ${s.repeatVsHoldout.heldBack} held back, ${s.repeatVsHoldout.experiments} test${s.repeatVsHoldout.experiments === 1 ? "" : "s"}` : "No finished test yet"}
        />
        <Tile
          label="Forecast error vs naive guess"
          value={s.forecast?.beatPct != null ? `${s.forecast.beatPct >= 0 ? "−" : "+"}${Math.abs(s.forecast.beatPct).toFixed(0)}%` : "—"}
          sub={s.forecast?.beatPct != null ? `Model miss ${fmtCurrency(s.forecast.modelMae)}/day vs ${fmtCurrency(s.forecast.naiveMae)}/day for “${s.forecast.naiveName}”` : "Open the Forecast page to run a backtest"}
        />
      </div>
    </Card>
  );
}
