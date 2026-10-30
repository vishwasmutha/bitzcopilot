import type { ReactNode } from "react";
import { Crown, DollarSign, Lightbulb, Repeat, UserMinus, UserPlus, Users, UserX } from "lucide-react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { getCustomerAnalytics } from "@/lib/analytics";
import { fmtCurrency, fmtNumber } from "@/lib/utils";
import { Badge, Card } from "@/components/ui";
import { BarsChart, DonutChart } from "@/components/charts";

export const dynamic = "force-dynamic";

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="font-display mt-2 text-[22px] font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
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
    <div className="bc-fade-up space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Customer Intelligence</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          RFM segmentation (Recency, Frequency, Monetary) over your customer-linked sales. Only data belonging to your business is shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi icon={<Users className="h-4 w-4" />} label="Total customers" value={fmtNumber(c.total)} />
        <Kpi icon={<Repeat className="h-4 w-4" />} label="Repeat (2+ orders)" value={fmtNumber(c.repeat)} sub={c.total ? `${Math.round((c.repeat / c.total) * 100)}% of base` : undefined} />
        <Kpi icon={<UserPlus className="h-4 w-4" />} label="New (30d)" value={fmtNumber(c.new30)} />
        <Kpi icon={<UserMinus className="h-4 w-4" />} label="Active (30d)" value={fmtNumber(c.active30)} />
        <Kpi icon={<UserX className="h-4 w-4" />} label="Inactive (45d+)" value={fmtNumber(c.inactive45)} />
        <Kpi icon={<DollarSign className="h-4 w-4" />} label="Avg spend / customer" value={c.avgSpent ? fmtCurrency(c.avgSpent) : "—"} sub={c.avgOrdersPerCustomer ? `${c.avgOrdersPerCustomer.toFixed(1)} orders each` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Segment mix" sub="By customer count">
          {segmentDonut.length ? <DonutChart data={segmentDonut} height={220} /> : <NoCust />}
        </Card>
        <Card title="New customers per month" sub="Trailing 6 months">
          {c.monthly.some((m) => m.newCustomers > 0) ? (
            <BarsChart data={c.monthly.map((m) => ({ label: m.label, value: m.newCustomers }))} height={220} color="#8b5cf6" prefix="" />
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
                    <p className="truncate text-[13px] font-medium">{t.name ?? t.refId}</p>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {c.segments.map((s) => (
          <Card key={s.name} title={s.name} sub={`${s.count} customer${s.count === 1 ? "" : "s"} · ${fmtCurrency(s.revenue, true)} lifetime`}>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">{s.description}</p>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-brand-50/70 px-3 py-2.5 text-[12.5px] text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {s.suggestion}
            </div>
            {s.members.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
                {s.members.slice(0, 3).map((m) => (
                  <div key={m.refId} className="flex items-center justify-between text-xs">
                    <span className="truncate text-slate-600 dark:text-slate-300">{m.name ?? m.refId}</span>
                    <span className="shrink-0 text-slate-400">
                      {m.orders} orders · {fmtCurrency(m.spent, true)} · last {m.recencyDays}d
                    </span>
                  </div>
                ))}
                {s.count > 3 && <p className="text-[11px] text-slate-400">+{s.count - 3} more in this segment</p>}
              </div>
            )}
          </Card>
        ))}
      </div>
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
