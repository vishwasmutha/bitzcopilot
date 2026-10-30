"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { MathReceipt, type ReceiptData } from "@/components/receipt";
import { CashChart } from "@/components/cash-chart";
import { CollectionsPanel } from "@/components/collections-panel";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency, shortDate } from "@/lib/utils";

type Item = { id: string; kind: "receivable" | "payable" | "recurring"; party: string; amount: number; issuedOn: string; dueDate: string; recurrence: string; status: "open" | "settled"; note: string | null };
type Projection =
  | { status: "insufficient"; why: string }
  | {
      status: "ok";
      days: { date: string; low: number; mid: number; high: number }[];
      weeks: { weekStart: string; inMid: number; outMid: number; low: number; mid: number; high: number }[];
      crunch: { date: string; weeksAhead: number; likelihood: "likely" | "possible"; shortfall: number } | null;
      lowest: Record<"low" | "mid" | "high", { date: string; balance: number }>;
      assumptions: { label: string; detail: string }[];
    };
type Outlook = {
  openingCash: number | null;
  openingCashOn: string | null;
  stale: boolean;
  projection: Projection;
  params: { creditSharePct: number; cogsPct: number; cogsAssumed: boolean; bandPct: number };
  openReceivables: number;
  openPayables: number;
};

const KIND_LABEL = { receivable: "Credit owed to you", payable: "Supplier due", recurring: "Rent or salary" } as const;

export default function CashPage() {
  const { push } = useToast();
  const [data, setData] = useState<{ outlook: Outlook; items: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cash, setCash] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const [form, setForm] = useState({ kind: "payable", party: "", amount: "", dueDate: "", recurrence: "none" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      authFetch("/api/cash")
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not load.");
          setData(j);
          setCash((c) => (c === "" && j.outlook.openingCash != null ? String(j.outlook.openingCash) : c));
        })
        .catch((e: Error) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const saveCash = async () => {
    setSaving(true);
    try {
      const r = await authFetch("/api/cash", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openingCash: Number(cash) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not save", desc: j.error, tone: "error" });
      push({ title: "Cash balance saved", tone: "success" });
      load();
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    setAdding(true);
    try {
      const r = await authFetch("/api/cash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not add", desc: j.error, tone: "error" });
      push({ title: "Added", tone: "success" });
      setForm({ ...form, party: "", amount: "" });
      load();
    } finally {
      setAdding(false);
    }
  };

  const settle = async (id: string) => {
    await authFetch("/api/cash", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settleId: id }) });
    load();
  };
  const remove = async (id: string) => {
    await authFetch(`/api/cash?id=${id}`, { method: "DELETE" });
    load();
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">{error}</p>;
  if (!data) return <Spinner label="Rolling your cash forward…" />;

  const { outlook, items } = data;
  const p = outlook.projection;
  const open = items.filter((i) => i.status === "open");
  const receipt: ReceiptData | null =
    p.status === "ok"
      ? { title: "Cash outlook", status: "computed", headline: p.crunch ? `${p.crunch.likelihood === "likely" ? "Expected" : "Possible"} shortfall of ${fmtCurrency(p.crunch.shortfall)} around ${p.crunch.date}` : "No shortfall in the next 8 weeks", steps: p.assumptions, caveat: "A projection, not a promise. The low and high cases show how far it could swing." }
      : { title: "Cash outlook", status: "insufficient", headline: "Not enough to project", steps: [{ label: "Why", detail: p.why }] };

  return (
    <div className="bc-fade-up space-y-6">
      <PageHeader title="Cash outlook" desc="Looks 8 weeks ahead and warns you before cash runs short. It combines expected sales, credit you are owed, supplier dues and rent." />

      <Card title="Cash you have today" sub={outlook.openingCashOn ? `Last updated ${shortDate(outlook.openingCashOn)}${outlook.stale ? ". This is more than 3 days old, so update it." : ""}` : "Cash in the till plus money in the bank and UPI."}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Amount in ₹">
            <Input id="opening-cash" type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="e.g. 85000" className="sm:w-56" />
          </Field>
          <Button onClick={saveCash} loading={saving} disabled={cash === "" || saving}>
            <Wallet className="h-4 w-4" /> Save balance
          </Button>
        </div>
      </Card>

      <CollectionsPanel onChange={load} />

      {p.status === "insufficient" ? (
        <Card title="Projection">
          <p className="py-6 text-center text-sm text-slate-500">{p.why}</p>
        </Card>
      ) : (
        <>
          <div
            role="status"
            className={
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm " +
              (p.crunch
                ? p.crunch.likelihood === "likely"
                  ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300")
            }
          >
            {p.crunch ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>
              {p.crunch ? (
                <>
                  <p className="font-semibold">
                    {p.crunch.likelihood === "likely" ? "Cash is expected to run short" : "Cash could run short"} around {shortDate(p.crunch.date)}, about {p.crunch.weeksAhead} week{p.crunch.weeksAhead === 1 ? "" : "s"} from now.
                  </p>
                  <p className="mt-0.5 text-sm">
                    The gap reaches {fmtCurrency(p.crunch.shortfall)}. Collecting the {fmtCurrency(outlook.openReceivables)} owed to you, or asking a supplier to move a due date, are the quickest ways to close it.
                  </p>
                </>
              ) : (
                <p className="font-semibold">No shortfall in the next 8 weeks on current numbers. The lowest expected balance is {fmtCurrency(p.lowest.mid.balance)} on {shortDate(p.lowest.mid.date)}.</p>
              )}
            </div>
          </div>

          <Card title="Projected cash, next 8 weeks" sub={`Line is the expected balance. The shaded band runs from the low case to the high case (sales ±${outlook.params.bandPct}%, slower or full collection of credit).`}>
            <CashChart days={p.days} crunchDate={p.crunch?.date} />
            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              {(["low", "mid", "high"] as const).map((k) => (
                <div key={k} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                  <p className="text-slate-500 dark:text-slate-400">Lowest point, {k === "mid" ? "expected" : `${k} case`}</p>
                  <p className={"font-display mt-0.5 text-base font-bold tabular-nums " + (p.lowest[k].balance < 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white")}>{fmtCurrency(p.lowest[k].balance)}</p>
                  <p className="text-slate-400">on {shortDate(p.lowest[k].date)}</p>
                </div>
              ))}
            </div>
            {receipt && <MathReceipt receipt={receipt} />}
          </Card>

          <Card title="Week by week" sub="Cash in and out in the expected case, and the balance at the end of each week" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="border-b border-slate-100 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="px-5 py-3 font-medium">Week of</th>
                    <th className="px-3 py-3 text-right font-medium">Cash in</th>
                    <th className="px-3 py-3 text-right font-medium">Cash out</th>
                    <th className="px-3 py-3 text-right font-medium">Low case</th>
                    <th className="px-3 py-3 text-right font-medium">Expected</th>
                    <th className="px-5 py-3 text-right font-medium">High case</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
                  {p.weeks.map((w) => (
                    <tr key={w.weekStart}>
                      <td className="px-5 py-2.5">{shortDate(w.weekStart)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtCurrency(w.inMid)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtCurrency(w.outMid)}</td>
                      <td className={"px-3 py-2.5 text-right " + (w.low < 0 ? "font-semibold text-red-600 dark:text-red-400" : "")}>{fmtCurrency(w.low)}</td>
                      <td className={"px-3 py-2.5 text-right font-medium " + (w.mid < 0 ? "text-red-600 dark:text-red-400" : "")}>{fmtCurrency(w.mid)}</td>
                      <td className="px-5 py-2.5 text-right">{fmtCurrency(w.high)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Add what is owed or due" sub="Credit you gave, supplier bills and rent" className="xl:col-span-1 h-fit">
          <div className="space-y-3">
            <Field label="What is it?">
              <Select id="cash-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, recurrence: e.target.value === "recurring" ? "monthly" : "none" })}>
                <option value="payable">Supplier due (you owe)</option>
                <option value="receivable">Credit given (customer owes you)</option>
                <option value="recurring">Rent or salary (repeats)</option>
              </Select>
            </Field>
            <Field label={form.kind === "receivable" ? "Customer" : form.kind === "payable" ? "Supplier" : "What for"}>
              <Input id="cash-party" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} placeholder={form.kind === "receivable" ? "Ramesh" : form.kind === "payable" ? "Wholesaler" : "Shop rent"} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount in ₹">
                <Input id="cash-amount" type="number" inputMode="decimal" min={1} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label={form.recurrence === "none" ? "Due on" : "First due on"}>
                <Input id="cash-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </Field>
            </div>
            {form.kind === "recurring" && (
              <Field label="Repeats">
                <Select id="cash-recur" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
                  <option value="monthly">Every month</option>
                  <option value="weekly">Every week</option>
                </Select>
              </Field>
            )}
            <Button onClick={addItem} loading={adding} disabled={!form.party.trim() || !form.amount || !form.dueDate || adding} className="w-full">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </Card>

        <Card title="Open items" sub={`${open.length} open · ${fmtCurrency(outlook.openReceivables)} owed to you · ${fmtCurrency(outlook.openPayables)} to pay`} className="xl:col-span-2" pad={false}>
          {open.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Nothing recorded. Add supplier dues, rent and credit you have given so the outlook sees them.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {open
                .slice()
                .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                .slice(0, showAllOpen ? undefined : 8)
                .map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <Badge tone={i.kind === "receivable" ? "success" : "warning"}>{KIND_LABEL[i.kind]}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.party}</span>
                    <span className="text-xs text-slate-400">
                      {i.recurrence !== "none" ? `${i.recurrence} from ` : "due "}
                      {shortDate(i.dueDate)}
                    </span>
                    <span className="w-24 text-right text-sm font-semibold tabular-nums">{fmtCurrency(i.amount)}</span>
                    <button onClick={() => settle(i.id)} className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10" title={i.kind === "receivable" ? "Mark as collected" : "Mark as paid"}>
                      {i.kind === "receivable" ? "Collected" : i.kind === "recurring" ? "Stop" : "Paid"}
                    </button>
                    <button onClick={() => remove(i.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Delete" aria-label={`Delete ${i.party}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {open.length > 8 && (
            <div className="border-t border-slate-100 px-5 py-3 text-center">
              <button onClick={() => setShowAllOpen(!showAllOpen)} className="text-sm font-semibold text-brand-600 hover:underline">
                {showAllOpen ? "Show fewer" : `Show all ${open.length} items`}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
