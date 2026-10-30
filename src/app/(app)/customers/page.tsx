import type { ReactNode } from "react";
import { Crown, DollarSign, Lightbulb, Repeat, UserMinus, UserPlus, Users, UserX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { getCustomerAnalytics } from "@/lib/analytics";
import { fmtCurrency, fmtNumber } from "@/lib/utils";
import { Badge, Card, PageHeader } from "@/components/ui";
import { BarsChart, DonutChart } from "@/components/charts";
import { ConsentManager } from "@/components/consent-manager";
import { SegmentBuilder } from "@/components/segment-builder";

export const dynamic = "force-dynamic";

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-display mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

export default async function CustomersPage() {
  const session = await getSession();
  if (!session) return <SessionBootstrap />;
  if (!session.business) redirect("/onboarding");
  const c = await getCustomerAnalytics(session.business.id);

  const segmentDonut = c.segments.map((s) => ({ label: s.name.replace(" customers", ""), value: s.count }));

  return (
    <div className="bc-fade-up space-y-8">
      <PageHeader title="Customer Intelligence" desc="RFM segmentation (Recency, Frequency, Monetary) over your customer-linked sales. Only data belonging to your business is shown." />

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Users className="h-4 w-4" />} label="Total customers" value={fmtNumber(c.total)} />
        <Kpi icon={<Repeat className="h-4 w-4" />} label="Repeat (2+ orders)" value={fmtNumber(c.repeat)} sub={c.total ? `${Math.round((c.repeat / c.total) * 100)}% of base` : undefined} />
        <Kpi icon={<UserPlus className="h-4 w-4" />} label="New (30d)" value={fmtNumber(c.new30)} />
        <Kpi icon={<UserMinus className="h-4 w-4" />} label="Active (30d)" value={fmtNumber(c.active30)} />
        <Kpi icon={<UserX className="h-4 w-4" />} label="Inactive (45d+)" value={fmtNumber(c.inactive45)} />
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="Avg spend / customer" value={c.avgSpent ? fmtCurrency(c.avgSpent) : "—"} sub={c.avgOrdersPerCustomer ? `${c.avgOrdersPerCustomer.toFixed(1)} orders each` : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Segment mix" sub="By customer count">
          {segmentDonut.length ? <DonutChart data={segmentDonut} height={220} /> : <NoCust />}
        </Card>
        <Card title="New customers per month" sub="Trailing 6 months">
          {c.monthly.some((m) => m.newCustomers > 0) ? (
            <BarsChart data={c.monthly.map((m) => ({ label: m.label, value: m.newCustomers }))} height={220} color="#3a2415" prefix="" />
          ) : (
            <NoCust />
          )}
        </Card>
        <Card title="Top spenders" sub="Lifetime value">
          {c.topSpenders.length ? (
            <ul className="space-y-3">
              {c.topSpenders.map((t, i) => (
                <li key={t.refId} className="flex items-center gap-3">
                  <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold " + (i === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                    {i === 0 ? <Crown className="h-4 w-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name ?? t.refId}</p>
                    <p className="text-xs text-slate-400">{t.orders} orders</p>
                  </div>
                  <span className="font-display text-sm font-semibold">{fmtCurrency(t.spent, true)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <NoCust />
          )}
        </Card>
      </div>

      <SegmentBuilder />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {c.segments.map((s) => (
          <Card key={s.name} title={s.name} sub={`${s.count} customer${s.count === 1 ? "" : "s"} · ${fmtCurrency(s.revenue, true)} lifetime`}>
            <p className="text-[15px] leading-7 text-slate-600">{s.description}</p>
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-brand-50 px-4 py-3.5 text-sm font-medium leading-6 text-brand-800">
              <Lightbulb className="mt-1 h-4 w-4 shrink-0" />
              {s.suggestion}
            </div>
            {s.members.length > 0 && (
              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                {s.members.slice(0, 3).map((m) => (
                  <div key={m.refId} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-slate-900">{m.name ?? m.refId}</p>
                      <p className="text-xs text-slate-500">
                        {m.orders} order{m.orders === 1 ? "" : "s"} · last {m.recencyDays}d ago
                      </p>
                    </div>
                    <span className="font-display shrink-0 text-base font-semibold text-slate-900">{fmtCurrency(m.spent, true)}</span>
                  </div>
                ))}
                {s.count > 3 && <p className="text-sm text-slate-500">+{s.count - 3} more in this segment</p>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <ConsentManager />
    </div>
  );
}

function NoCust() {
  return (
    <div className="flex min-h-[180px] items-center justify-center">
      <div className="max-w-[240px] text-center">
        <Badge tone="neutral">No customer-linked sales</Badge>
        <p className="mt-2 text-xs text-slate-400">
          Sales rows that include a Customer ID unlock RFM analysis. Import a sales file with a customer column.
        </p>
      </div>
    </div>
  );
}
