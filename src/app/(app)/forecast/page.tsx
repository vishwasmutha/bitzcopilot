"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarRange, Gauge, LineChart as LineIcon, PackageSearch } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, useToast } from "@/components/ui";
import { ForecastChart, BarsChart } from "@/components/charts";
import { fmtCurrency, fmtNumber, fmtPercent, shortDate } from "@/lib/utils";

type Forecast = {
  status: "ok" | "limited" | "insufficient";
  availableDays: number;
  spanDays: number;
  horizon: number;
  model: string;
  modelNote: string;
  metrics: { mae: number; rmse: number; mape: number | null; evaluated: string };
  history: { date: string; actual: number; predicted?: number }[];
  forecast: { date: string; predicted: number; lower: number; upper: number }[];
  weeklyPattern: { dow: string; avg: number }[];
  productDemand: { name: string; dailyRate: number; predictedWeekly: number; stock: number | null; stockCoversDays: number | null }[];
  totalPredicted: number;
  trendPct: number | null;
  message: string | null;
  confidence?: { level: "high" | "medium" | "low" | "none"; reason: string };
  candidates?: { name: string; mae: number | null; chosen: boolean }[];
  backtest?: {
    status: "computed" | "insufficient";
    holdoutDays: number;
    modelMae: number | null;
    naiveMae: number | null;
    naiveName: string;
    beatPct: number | null;
    note: string;
  };
};

export default function ForecastPage() {
  const { push } = useToast();
  const [horizon, setHorizon] = useState(7);
  const [busy, setBusy] = useState(false);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      const r = await fetch(`/api/forecast?horizon=${horizon}`);
      const j = await r.json();
      if (j.found && j.series) {
        // restore minimal view from stored series
        setFc({
          status: "ok",
          availableDays: 0,
          spanDays: 0,
          horizon: j.horizonDays,
          model: j.modelName,
          modelNote: "Restored from the last saved run — regenerate for fresh numbers.",
          metrics: j.metrics,
          history: (j.series.history ?? []).map((h: any) => ({ date: h.date, actual: h.actual, predicted: h.predicted })),
          forecast: (j.series.forecast ?? []).map((f: any) => ({ date: f.date, predicted: f.predicted, lower: f.lower, upper: f.upper })),
          weeklyPattern: [],
          productDemand: [],
          totalPredicted: (j.series.forecast ?? []).reduce((a: number, f: any) => a + f.predicted, 0),
          trendPct: null,
          message: null,
          backtest: j.metrics?.backtest,
        });
        setGeneratedAt(j.createdAt);
      }
    } catch {
      /* ignore */
    }
  }, [horizon]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLatest(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLatest]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon }),
      });
      const j = await r.json();
      if (!r.ok) {
        push({ title: "Forecast failed", desc: j.error ?? "Try again.", tone: "error" });
        return;
      }
      setFc(j);
      setGeneratedAt(new Date().toISOString());
      if (j.status === "ok" || j.status === "limited")
        push({ title: "Forecast generated", desc: `${j.horizon}-day forecast with ${j.model}.`, tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const chartData = fc
    ? [
        ...fc.history.slice(-45).map((h) => ({ label: h.date.slice(5), actual: h.actual, fit: h.predicted })),
        ...fc.forecast.map((f) => ({ label: f.date.slice(5), predicted: f.predicted, lower: f.lower, upper: f.upper })),
      ]
    : [];

  return (
    <div className="bc-fade-up">
      <PageHeader
        title="Sales Forecasting"
        desc="Two statistical models — trend regression and Holt-Winters weekly seasonality — are tested on a holdout window; the stronger one forecasts your next days."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
              {[7, 14, 30, 60].map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                    (horizon === h ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")
                  }
                >
                  {h}d
                </button>
              ))}
            </div>
            <Button onClick={generate} loading={busy}>
              Generate forecast
            </Button>
          </div>
        }
      />

      {busy && <Card><Spinner label="Fitting models on your history…" /></Card>}

      {!busy && !fc && (
        <Card>
          <EmptyState
            icon={<LineIcon className="h-5 w-5" />}
            title="No forecast yet"
            desc="Pick a horizon and generate — the model is trained on your stored sales and evaluated before it predicts."
            action={<Button onClick={generate} loading={busy}>Generate {horizon}-day forecast</Button>}
          />
        </Card>
      )}

      {!busy && fc && fc.status === "insufficient" && (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Not enough history yet"
            desc={fc.message ?? "The model needs at least two weeks of sales data."}
            action={
              <a href="/data" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Import sales data
              </a>
            }
          />
        </Card>
      )}

      {!busy && fc && fc.status !== "insufficient" && (
        <div className="space-y-4">
          {fc.backtest && (
            <div className={"rounded-xl border px-4 py-3 text-sm " + (fc.backtest.status === "insufficient" ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200" : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200")}>
              <p className="font-semibold">
                {fc.backtest.status === "insufficient"
                  ? "Backtest withheld — not enough history"
                  : fc.backtest.beatPct != null && fc.backtest.beatPct >= 0
                    ? `Backtest: forecast beat a naive baseline by ${fc.backtest.beatPct.toFixed(1)}%`
                    : `Backtest: forecast did not beat the naive baseline`}
              </p>
              <p className="mt-1">{fc.backtest.note}</p>
              {fc.backtest.status === "computed" && (
                <p className="mt-1 text-xs opacity-80">
                  Model MAE {fmtCurrency(fc.backtest.modelMae ?? 0)} vs {fc.backtest.naiveName} MAE {fmtCurrency(fc.backtest.naiveMae ?? 0)} on {fc.backtest.holdoutDays} held-out days.
                </p>
              )}
            </div>
          )}
          {fc.status === "limited" && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Under 6 weeks of history — the model is fitted on all available data without holdout validation, so treat the numbers as directional.
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><CalendarRange className="h-4 w-4" /> Predicted revenue ({fc.horizon}d)</p>
              <p className="font-display mt-3 text-3xl font-bold">{fmtCurrency(fc.totalPredicted)}</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Gauge className="h-4 w-4" /> Model</p>
              <p className="font-display mt-3 text-lg font-bold leading-snug">{fc.model}</p>
              {fc.confidence && fc.confidence.level !== "none" && (
                <p className="mt-1">
                  <Badge tone={fc.confidence.level === "high" ? "success" : fc.confidence.level === "medium" ? "info" : "warning"}>Confidence: {fc.confidence.level}</Badge>
                </p>
              )}
              <p className="mt-1.5 text-sm text-slate-500">{fc.trendPct != null ? `run-rate ${fmtPercent(fc.trendPct, true)} vs prior 2 wks` : `${fc.availableDays} active days used`}</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Gauge className="h-4 w-4" /> Accuracy ({fc.metrics.evaluated})</p>
              <p className="font-display mt-3 text-lg font-bold leading-snug">
                MAE {fmtCurrency(fc.metrics.mae)} · RMSE {fmtCurrency(fc.metrics.rmse)}
              </p>
              <p className="mt-1.5 text-sm text-slate-500">{fc.metrics.mape != null ? `MAPE ${fc.metrics.mape.toFixed(1)}%` : "MAPE n/a (low actuals)"}</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><LineIcon className="h-4 w-4" /> Generated</p>
              <p className="font-display mt-3 text-lg font-bold leading-snug">{generatedAt ? shortDate(generatedAt.slice(0, 10)) : "—"}</p>
              <p className="mt-1.5 text-sm text-slate-500">{fc.modelNote || "Best model on holdout"}</p>
            </div>
          </div>

          <Card title="Actual vs predicted" sub={`${fc.horizon}-day forecast · the shaded band is the confidence interval`}>
            <ForecastChart data={chartData} height={320} />
            {fc.modelNote && <p className="mt-3 text-xs text-slate-400">{fc.modelNote}</p>}
            {fc.confidence && fc.confidence.level !== "none" && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400"><strong>Confidence {fc.confidence.level}.</strong> {fc.confidence.reason}</p>}
          </Card>

          {fc.candidates && fc.candidates.length > 0 && (
            <Card title="Models compared" sub="Each model forecast the same held-out days. The one with the smallest average miss is used. A simple same-weekday average is always in the race, so a clever model has to beat it.">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="pb-2">Model</th>
                    <th className="pb-2 text-right">Average daily miss</th>
                    <th className="pb-2 pl-4">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {fc.candidates.map((c) => (
                    <tr key={c.name} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2">{c.name}</td>
                      <td className="py-2 text-right tabular-nums">{c.mae == null ? "could not be fitted" : fmtCurrency(c.mae)}</td>
                      <td className="py-2 pl-4">{c.chosen ? <Badge tone="success">chosen</Badge> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Weekly pattern" sub="Average revenue by weekday">
              {fc.weeklyPattern.length ? (
                <>
                  <BarsChart data={fc.weeklyPattern.map((w) => ({ label: w.dow, value: w.avg }))} height={230} />
                  <p className="mt-2 text-xs text-slate-400">
                    {(() => {
                      const best = fc.weeklyPattern.reduce((a, b) => (b.avg > a.avg ? b : a));
                      const worst = fc.weeklyPattern.reduce((a, b) => (b.avg < a.avg ? b : a));
                      return `${best.dow} is your strongest day (${fmtCurrency(best.avg)}/day); ${worst.dow} the quietest (${fmtCurrency(worst.avg)}/day). Staff and stock accordingly.`;
                    })()}
                  </p>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-slate-400">Regenerate to see the weekly pattern.</p>
              )}
            </Card>

            <Card title="Product demand" sub="Predicted weekly demand vs current stock" action={<Badge tone="info">Top 10</Badge>}>
              {fc.productDemand.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-slate-400">
                        <th className="pb-2 font-medium">Product</th>
                        <th className="pb-2 text-right font-medium">Daily rate</th>
                        <th className="pb-2 text-right font-medium">Forecast wk</th>
                        <th className="pb-2 text-right font-medium">Stock</th>
                        <th className="pb-2 text-right font-medium">Covers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {fc.productDemand.map((p) => {
                        const tight = p.stock != null && p.stockCoversDays != null && p.stockCoversDays < 14;
                        return (
                          <tr key={p.name}>
                            <td className="max-w-[160px] truncate py-2 font-medium">{p.name}</td>
                            <td className="py-2 text-right text-slate-500">{fmtNumber(p.dailyRate)}/d</td>
                            <td className="py-2 text-right font-semibold">{fmtNumber(p.predictedWeekly)}</td>
                            <td className="py-2 text-right">{p.stock ?? "—"}</td>
                            <td className="py-2 text-right">
                              {p.stockCoversDays == null ? "—" : (
                                <span className={tight ? "font-semibold text-amber-600 dark:text-amber-400" : "text-slate-500"}>
                                  {p.stockCoversDays}d{tight ? " ⚠" : ""}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-slate-400">
                  <PackageSearch className="h-6 w-6" />
                  Regenerate to compute product-level demand.
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
