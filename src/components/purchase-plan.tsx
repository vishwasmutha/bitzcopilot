"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "./ui";
import { MathReceipt, type ReceiptData } from "./receipt";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type Line = {
  id: string;
  name: string;
  stock: number;
  daily: number;
  daysCover: number | null;
  orderQty: number;
  moq: number;
  gstRate: number;
  cashOut: number;
  gst: number;
  funded: boolean;
  festivalName: string | null;
  reason: string;
  leadTimeDays: number;
  safetyStock: number;
  reorderPoint: number;
  risk: "ok" | "reorder_now" | "stockout_before_delivery";
  slow: boolean;
  cashTrapped: number;
};

type Plan = {
  status: string;
  receipt: ReceiptData;
  lines: Line[];
  slowMovers: { name: string; stock: number; coverDays: number | null; cashTrapped: number }[];
  cashTrapped: number;
  festivals: { name: string; daysAway: number | null; lift: number; note: string }[];
  budget: number | null;
  upiId: string | null;
  gstin: string | null;
  fundedCash: number;
  deferredCash: number;
  gstOnFunded: number;
};

export function PurchasePlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [festival, setFestival] = useState(true);
  const [budget, setBudget] = useState("");
  const [upi, setUpi] = useState("");
  const [gstin, setGstin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (fest = festival) => {
    const r = await authFetch(`/api/inventory/plan?festival=${fest ? "1" : "0"}`);
    const j = await r.json();
    if (r.ok) {
      setPlan(j);
      if (j.budget != null) setBudget(String(j.budget));
      if (j.upiId) setUpi(j.upiId);
      if (j.gstin) setGstin(j.gstin);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await authFetch("/api/inventory/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashBudget: budget, upiId: upi, gstin }),
      });
      await load(festival);
    } finally {
      setBusy(false);
    }
  };

  if (!plan) return null;
  const funded = plan.lines.filter((l) => l.funded && l.orderQty > 0);
  const deferred = plan.lines.filter((l) => !l.funded && l.orderQty > 0);

  return (
    <Card title="Cash-aware purchase plan" sub="MOQ, GST, UPI, and a labeled festival prior. Measured demand is never mixed with the prior silently." className="mb-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {plan.festivals.map((f) => (
          <Badge key={f.name} tone="warning">
            {f.name}
            {f.daysAway != null ? ` in ${f.daysAway}d` : ""} · prior ×{f.lift}
          </Badge>
        ))}
        {plan.festivals.length === 0 && <Badge tone="neutral">No festival window right now</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-500">
          Weekly cash budget (₹)
          <Input className="mt-1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="25000" />
        </label>
        <label className="text-xs text-slate-500">
          UPI ID
          <Input className="mt-1" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="shop@upi" />
        </label>
        <label className="text-xs text-slate-500">
          GSTIN
          <Input className="mt-1" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="29AAAAA0000A1Z5" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} loading={busy}>Save budget</Button>
        <button
          onClick={() => {
            const next = !festival;
            setFestival(next);
            load(next);
          }}
          className="text-xs font-medium text-brand-600"
        >
          {festival ? "Festival prior is on" : "Festival prior is off"} — tap to toggle
        </button>
      </div>
      {plan.receipt && <MathReceipt receipt={plan.receipt} />}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          <p className="text-xs text-slate-400">UPI debit today</p>
          <p className="font-display text-lg font-bold">{fmtCurrency(plan.fundedCash)}</p>
          <p className="text-xs text-slate-400">GST inside that: {fmtCurrency(plan.gstOnFunded)}{plan.gstin ? " · ITC if filed" : ""}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          <p className="text-xs text-slate-400">Deferred — over cash budget</p>
          <p className="font-display text-lg font-bold">{fmtCurrency(plan.deferredCash)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
          <p className="text-xs text-slate-400">Pay via</p>
          <p className="font-medium">{plan.upiId || "Add a UPI ID"}</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="pb-2">Item</th>
              <th className="pb-2">Cover</th>
              <th className="pb-2 text-right">Order</th>
              <th className="pb-2 text-right">GST</th>
              <th className="pb-2 text-right">Cash</th>
              <th className="pb-2">Fit</th>
            </tr>
          </thead>
          <tbody>
            {[...funded, ...deferred].slice(0, 8).map((l) => (
              <tr key={l.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-slate-400">{l.festivalName ? `${l.festivalName} prior` : "measured only"} · MOQ {l.moq}</p>
                  <p className="text-xs text-slate-400">Reorder at {l.reorderPoint} · {l.leadTimeDays}-day delivery · {l.safetyStock} safety stock</p>
                </td>
                <td className="py-2">{l.daysCover == null ? "—" : `${l.daysCover}d`}</td>
                <td className="py-2 text-right">{l.orderQty}</td>
                <td className="py-2 text-right">{l.gstRate}%</td>
                <td className="py-2 text-right">{fmtCurrency(l.cashOut)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {l.funded ? <Badge tone="success">funded</Badge> : <Badge tone="warning">deferred</Badge>}
                    {l.risk === "stockout_before_delivery" && <Badge tone="error">runs out before delivery</Badge>}
                    {l.risk === "reorder_now" && <Badge tone="warning">at reorder point</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.slowMovers.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <p className="font-semibold text-amber-900 dark:text-amber-200">{fmtCurrency(plan.cashTrapped)} is tied up in stock that is not selling</p>
          <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">Do not reorder these. Consider a bundle or a small discount to turn them back into cash.</p>
          <ul className="mt-2 divide-y divide-amber-200/70 text-xs dark:divide-amber-500/20">
            {plan.slowMovers.slice(0, 5).map((m) => (
              <li key={m.name} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">{m.name} · {m.stock} in stock · {m.coverDays == null ? "no sales in 28 days" : `${Math.round(m.coverDays)} days of cover`}</span>
                <span className="shrink-0 tabular-nums font-medium">{fmtCurrency(m.cashTrapped)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
