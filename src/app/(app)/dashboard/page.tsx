import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CircleDollarSign,
  FlaskConical,
  Info,
  Package,
  ReceiptText,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionBootstrap } from "@/components/session-bootstrap";
import {
  getCustomerAnalytics,
  getDailySalesSeries,
  getCategoryRevenue,
  getInsights,
  getMonthlyRevenue,
  getProductPerformance,
  getOverview,
} from "@/lib/analytics";
import { generateForecast } from "@/lib/forecast";
import { hasDemoData } from "@/lib/demo";
import { fmtCurrency, fmtNumber, fmtPercent, shortDate } from "@/lib/utils";
import { Badge, Card } from "@/components/ui";
import { BarsChart, CompareBars, DonutChart, ForecastChart, TrendArea } from "@/components/charts";

export const dynamic = "force-dynamic";

function Stat({ icon, label, value, sub, tone = "default" }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; tone?: "default" | "up" | "down" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="font-display mt-2 text-[22px] font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {sub && (
        <p className={"mt-0.5 flex items-center gap-1 text-xs " + (tone === "up" ? "text-emerald-600 dark:text-emerald-400" : tone === "down" ? "text-red-600 dark:text-red-400" : "text-slate-400")}>
          {sub}
        </p>
      )}
    </div>
  );
}

const TONE_ICON = {
  positive: <TrendingUp className="h-4 w-4 text-emerald-500" />,
  warning: <ShieldAlert className="h-4 w-4 text-amber-500" />,
  negative: <TrendingDown className="h-4 w-4 text-red-500" />,
  info: <Info className="h-4 w-4 text-brand-500" />,
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return <SessionBootstrap />;
  if (!session.business) redirect("/onboarding");
  const bizId = session.business.id;

  const [overview, daily30, monthly, perf, categories, cust, insights, isDemoData] = await Promise.all([
    getOverview(bizId),
    getDailySalesSeries(bizId, 30),
    getMonthlyRevenue(bizId, 8),
    getProductPerformance(bizId, 30),
    getCategoryRevenue(bizId, 30),
    getCustomerAnalytics(bizId),
    getInsights(bizId),
    hasDemoData(bizId),
  ]);

  const forecast = overview.hasData && overview.dataDays >= 14 ? await generateForecast(bizId, 7) : null;
  const fcData = forecast
    ? [
        ...forecast.history.slice(-30).map((h) => ({
          label: h.date.slice(5),
          actual: h.actual,
          fit: h.predicted,
        })),
        ...(forecast.history.length ? [] : []),
        ...forecast.forecast.map((f) => ({ label: f.date.slice(5), predicted: f.predicted, lower: f.lower, upper: f.upper })),
      ]
    : [];

  const top5 = perf.slice(0, 5).map((p) => ({ label: p.name, value: p.revenue }));
  const least = [...perf].filter((p) => p.revenue < (perf[0]?.revenue ?? 0)).sort((a, b) => a.revenue - b.revenue).slice(0, 5).map((p) => ({ label: p.name, value: p.revenue }));
  const catData = categories.slice(0, 6).map((c) => ({ label: c.category, value: c.revenue }));
  const custMonthly = cust.monthly.map((m) => ({ label: m.label, value: m.newCustomers }));

  // Month-over-month comparison: each month vs the one before it
  const last6 = monthly.slice(-6);
  const compare = last6.map((m, i) => ({
    label: m.label,
    current: m.revenue,
    previous: i > 0 ? last6[i - 1].revenue : 0,
  }));

  const recentNotifs = await db
    .select()
    .from(notifications)
    .where(eq(notifications.businessId, bizId))
    .orderBy(desc(notifications.createdAt))
    .limit(4);

  const growthTone = overview.growthPct == null ? "default" : overview.growthPct >= 0 ? "up" : "down";

  return (
    <div className="bc-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#128C7E]/30 bg-[#ecfdf3] px-4 py-3 text-[13px] text-[#075E54] dark:border-[#25D366]/20 dark:bg-[#25D366]/10 dark:text-emerald-200">
        <span>Owners get this on WhatsApp at 9 AM — voice notes in Kannada or Hindi, one tap to approve a promo. This desk view is secondary.</span>
        <Link href="/wa" className="font-semibold underline">Open WhatsApp</Link>
      </div>
      {isDemoData && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
          <FlaskConical className="h-4 w-4 shrink-0" />
          <span>
            This workspace contains a <strong>labelled demo dataset</strong>. It is isolated from your real data — reset it in{" "}
            <Link href="/settings" className="font-semibold underline">Settings</Link>.
          </span>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<CircleDollarSign className="h-4 w-4" />} label="Revenue (30d)" value={fmtCurrency(overview.revenue30)} tone={growthTone} sub={overview.growthPct != null ? (<span className="flex items-center gap-0.5">{overview.growthPct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{fmtPercent(overview.growthPct, true)} vs prior 30d</span>) : "no prior 30d data"} />
        <Stat icon={<ReceiptText className="h-4 w-4" />} label="Orders (30d)" value={fmtNumber(overview.orders30)} sub={`${fmtNumber(overview.totalOrders)} all-time`} />
        <Stat icon={<ShoppingCart className="h-4 w-4" />} label="Avg order value" value={overview.aov ? fmtCurrency(overview.aov) : "—"} sub="last 30 days" />
        <Stat icon={<Target className="h-4 w-4" />} label="Predicted (7d)" value={overview.predictedRevenue7 != null ? fmtCurrency(overview.predictedRevenue7) : "—"} sub={overview.predictedRevenue7 != null ? "trend model" : "needs 4+ wks of data"} />
        <Stat icon={<Package className="h-4 w-4" />} label="Products" value={fmtNumber(overview.productCount)} sub={`${overview.outOfStockCount} out of stock`} />
        <Stat icon={<Wallet className="h-4 w-4" />} label="Inventory value" value={fmtCurrency(overview.inventoryValue)} sub="at unit cost" />
        <Stat icon={<Users className="h-4 w-4" />} label="Active customers" value={fmtNumber(overview.activeCustomers30)} sub={`of ${fmtNumber(overview.totalCustomers)} total (30d)`} />
        <Stat icon={<Sparkles className="h-4 w-4" />} label="Total revenue" value={fmtCurrency(overview.totalRevenue, true)} sub={`${overview.dataDays} selling days on record`} />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Daily sales trend" sub="Last 30 days" className="xl:col-span-2">
          {overview.hasData ? (
            <TrendArea data={daily30.map((d) => ({ label: d.label, value: d.revenue }))} />
          ) : (
            <NoData />
          )}
        </Card>
        <Card title="Insights" sub="Auto-generated from your data" action={<Badge tone="info">Live</Badge>}>
          <ul className="space-y-3">
            {insights.map((ins, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                <span className="mt-0.5 shrink-0">{TONE_ICON[ins.tone]}</span>
                {ins.text}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Monthly revenue" sub="Trailing 8 months">
          {overview.hasData ? <CompareBars data={compare} height={240} /> : <NoData />}
        </Card>
        <Card title="Top-selling products" sub="Last 30 days by revenue">
          {top5.length ? <BarsChart data={top5} horizontal height={240} /> : <NoData />}
        </Card>
        <Card title="Category revenue" sub="Last 30 days">
          {catData.length ? <DonutChart data={catData} height={220} /> : <NoData />}
        </Card>
      </div>

      {/* Charts row 3 */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Actual vs predicted sales" sub={forecast ? `${forecast.model} · MAE ${fmtCurrency(forecast.metrics.mae)}` : "Needs more history"} className="xl:col-span-2">
          {forecast ? (
            <>
              <ForecastChart data={fcData} />
              <p className="mt-2 text-xs text-slate-400">
                Blue = actual · grey dashed = model fit · purple = next 7 days with ±98% confidence band.{" "}
                <Link href="/forecast" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Open full forecast →</Link>
              </p>
            </>
          ) : (
            <NoData msg="Forecasting unlocks with 2+ weeks of sales history." />
          )}
        </Card>
        <Card title="Least-selling products" sub="Last 30 days — candidates for a promo">
          {least.length ? (
            <BarsChart data={least} horizontal height={240} color="#f59e0b" />
          ) : (
            <NoData msg="Not enough product variety to rank yet." />
          )}
        </Card>
      </div>

      {/* Row 4: customer trend + alerts */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Customer purchase trends" sub="New customers per month">
          {overview.hasData ? <BarsChart data={custMonthly} height={230} color="#8b5cf6" prefix="" /> : <NoData />}
        </Card>
        <Card title="Recent alerts" sub="Sales, stock and engagement signals" action={<Link href="/notifications" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">View all</Link>} pad={false}>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentNotifs.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-slate-400">No alerts yet — nice and quiet.</p>
            )}
            {recentNotifs.map((n) => (
              <div key={n.id} className="flex gap-3 px-5 py-3">
                <span className={"mt-1 h-2 w-2 shrink-0 rounded-full " + (n.severity === "critical" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-500" : n.severity === "positive" ? "bg-emerald-500" : "bg-brand-500")} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
                </div>
                <span className="ml-auto shrink-0 text-[11px] text-slate-400">{shortDate(n.createdAt.toISOString().slice(0, 10))}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Top customers" sub="By lifetime spend">
          {cust.topSpenders.length ? (
            <ul className="space-y-2.5">
              {cust.topSpenders.map((c, i) => (
                <li key={c.refId} className="flex items-center gap-3">
                  <span className="font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-bold text-navy-700 dark:bg-slate-800 dark:text-slate-300">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">{c.name ?? c.refId}</p>
                    <p className="text-xs text-slate-400">{c.orders} orders</p>
                  </div>
                  <span className="font-display text-sm font-semibold">{fmtCurrency(c.spent, true)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <NoData msg="Customer IDs in your sales unlock this view." />
          )}
        </Card>
      </div>

      {!overview.hasData && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <BellRing className="h-8 w-8 text-slate-300" />
            <h3 className="font-display text-lg font-semibold">Your dashboard is waiting for data</h3>
            <p className="max-w-md text-sm text-slate-500">Import a sales file on the Data page, or load the demo dataset from Settings to see every chart and insight in action.</p>
            <div className="flex gap-2">
              <Link href="/data" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Import data</Link>
              <Link href="/settings" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">Load demo data</Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function NoData({ msg }: { msg?: string }) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <p className="max-w-[240px] text-center text-sm text-slate-400">{msg ?? "No data yet — import a file on the Data page to populate this chart."}</p>
    </div>
  );
}
