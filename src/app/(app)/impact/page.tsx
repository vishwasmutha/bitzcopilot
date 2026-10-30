"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { BenchmarkPanel, DropPanel, ExperimentsPanel, LiftPanel, ActionList, ScorecardPanel, useImpact } from "@/components/impact-panels";
import { Button, PageHeader, Spinner } from "@/components/ui";
import { authFetch } from "@/lib/client-auth";

export default function ImpactPage() {
  const { data, error, reload } = useImpact({ limit: 5 });
  // Let autopilot look at the shop once per visit. It logs at most once a day per item.
  useEffect(() => {
    authFetch("/api/autopilot", { method: "POST" }).catch(() => {});
  }, []);
  return (
    <div className="bc-fade-up space-y-6">
      <PageHeader
        title="Impact"
        desc="What to do today, why sales moved, and whether the last promotion paid off. Every figure shows how it was worked out."
        actions={
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      ) : !data ? (
        <Spinner label="Reading your sales…" />
      ) : (
        <>
          <section aria-labelledby="actions-h">
            <h2 id="actions-h" className="font-display mb-2 text-base font-semibold text-slate-900 dark:text-white">Today&apos;s priorities</h2>
            <ActionList actions={data.actions} />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <DropPanel drop={data.drop} />
            <BenchmarkPanel report={data.benchmarks} />
          </div>
          <ExperimentsPanel experiments={data.experiments} onChange={reload} />
          <LiftPanel lifts={data.lifts} />
          <ScorecardPanel s={data.scorecard} />
        </>
      )}
    </div>
  );
}
