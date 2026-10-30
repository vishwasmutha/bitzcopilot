"use client";

import { useCallback, useEffect, useState } from "react";
import { PackagePlus, Pencil, Plus, RefreshCcw, Trash2, PackageSearch } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { fmtCurrency, fmtNumber } from "@/lib/utils";
import { PurchasePlan } from "@/components/purchase-plan";

type Rec = {
  id: string;
  name: string;
  category: string;
  stockQty: number;
  minStock: number;
  unitCost: number;
  sellingPrice: number;
  lastRestockedAt: Date | string | null;
  dailyRate: number;
  predictedWeekly: number;
  suggested: number;
  daysCover: number | null;
  status: "out" | "low" | "ok" | "over";
  slowMoving: boolean;
  trendUp: boolean;
  trendDown: boolean;
};

type Summary = { outOfStock: number; low: number; overstocked: number; slowMoving: number; reorderValue: number };

const STATUS_BADGE: Record<Rec["status"], { label: string; tone: "error" | "warning" | "success" | "info" }> = {
  out: { label: "Out of stock", tone: "error" },
  low: { label: "Low stock", tone: "warning" },
  ok: { label: "Healthy", tone: "success" },
  over: { label: "Overstocked", tone: "info" },
};

export default function InventoryPage() {
  const { push } = useToast();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<"recs" | "all" | "history">("recs");
  const [modal, setModal] = useState<"add" | "edit" | "restock" | "delete" | null>(null);
  const [target, setTarget] = useState<Rec | null>(null);
  const [form, setForm] = useState({ name: "", category: "Other", unitCost: "", sellingPrice: "", stockQty: "", minStock: "" });
  const [restockQty, setRestockQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<Rec | null>(null);
  const [history, setHistory] = useState<{ id: string; type: string; qtyChange: number; note: string | null; createdAt: Date | string; productName: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/inventory/recommendations");
      const j = await r.json();
      if (r.ok) {
        setRecs(j.recommendations ?? []);
        setSummary(j.summary ?? null);
      }
    } catch {
      setRecs([]);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadHistory = async (p: Rec) => {
    setHistoryFor(p);
    setHistory([]);
    const r = await fetch(`/api/inventory?history=${p.id}`);
    const j = await r.json();
    setHistory((j.history ?? []).reverse());
  };

  const openAdd = () => {
    setForm({ name: "", category: "Other", unitCost: "", sellingPrice: "", stockQty: "", minStock: "" });
    setModal("add");
  };
  const openEdit = (p: Rec) => {
    setTarget(p);
    setForm({ name: p.name, category: p.category ?? "Other", unitCost: String(p.unitCost), sellingPrice: String(p.sellingPrice), stockQty: String(p.stockQty), minStock: String(p.minStock) });
    setModal("edit");
  };
  const openRestock = (p: Rec) => {
    setTarget(p);
    setRestockQty(String(p.suggested > 0 ? p.suggested : p.minStock * 2 || 10));
    setModal("restock");
  };

  const submitProduct = async () => {
    setBusy(true);
    try {
      const isEdit = modal === "edit";
      const r = await fetch(isEdit ? `/api/inventory/${target?.id}` : "/api/inventory", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) return push({ title: "Saved failed", desc: j.error, tone: "error" });
      push({ title: isEdit ? "Product updated" : "Product added", desc: form.name, tone: "success" });
      setModal(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const doRestock = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/${target?.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: Number(restockQty) }),
      });
      const j = await r.json();
      if (!r.ok) return push({ title: "Restock failed", desc: j.error, tone: "error" });
      push({ title: "Restock recorded", desc: `${target?.name}: +${restockQty} units`, tone: "success" });
      setModal(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/inventory/${target?.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) return push({ title: "Delete failed", desc: j.error, tone: "error" });
      push({ title: "Product deleted", desc: target?.name, tone: "info" });
      setModal(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const rows = recs ?? [];

  return (
    <div className="bc-fade-up">
      <PageHeader
        title="Smart Inventory"
        desc="Stock health combined with your recent demand and forecast — reorder quantities are computed, not guessed."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}>
              <RefreshCcw className="h-4 w-4" /> Refresh
            </Button>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add product
            </Button>
          </div>
        }
      />

      {summary && (
        <div className="mb-8 grid grid-cols-2 gap-5 lg:grid-cols-5">
          {[
            { label: "Out of stock", value: summary.outOfStock, tone: "text-red-600 dark:text-red-400" },
            { label: "Low stock", value: summary.low, tone: "text-amber-600 dark:text-amber-400" },
            { label: "Overstocked", value: summary.overstocked, tone: "text-brand-600 dark:text-brand-400" },
            { label: "Slow movers", value: summary.slowMoving, tone: "text-slate-600 dark:text-slate-300" },
            { label: "Reorder value", value: fmtCurrency(summary.reorderValue, true), tone: "text-slate-900 dark:text-white" },
          ].map((s) => (
            <div key={s.label} className="rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{s.label}</p>
              <p className={"font-display mt-2 text-2xl font-bold " + s.tone}>{s.value}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mb-8">
        <PurchasePlan />
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 w-fit">
        {(["recs", "all", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors " +
              (tab === t ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")
            }
          >
            {t === "recs" ? "Recommendations" : t === "all" ? "All products" : "Stock history"}
          </button>
        ))}
      </div>

      {tab !== "history" ? (
        <Card pad={false}>
          {recs === null ? (
            <Spinner label="Computing recommendations…" />
          ) : rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<PackageSearch className="h-5 w-5" />}
                title="No products yet"
                desc="Add your catalog manually or import a product/inventory file from the Data page."
                action={<Button onClick={openAdd}>Add your first product</Button>}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400 dark:border-slate-800">
                    <th className="px-5 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Stock</th>
                    <th className="px-3 py-3 text-right font-medium">Min</th>
                    <th className="px-3 py-3 text-right font-medium">Cost</th>
                    <th className="px-3 py-3 text-right font-medium">Price</th>
                    <th className="px-3 py-3 text-right font-medium">Forecast wk</th>
                    <th className="px-3 py-3 text-right font-medium">Covers</th>
                    <th className="px-3 py-3 text-right font-medium">Suggested +</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(tab === "recs" ? [...rows].sort((a, b) => b.suggested - a.suggested) : rows).map((p) => {
                    const sb = STATUS_BADGE[p.status];
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="max-w-[200px] px-5 py-3">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-xs text-slate-400">
                            {p.category}
                            {p.trendUp && <span className="ml-1.5 text-emerald-500">▲ demand up</span>}
                            {p.trendDown && <span className="ml-1.5 text-red-500">▼ demand down</span>}
                            {p.slowMoving && <span className="ml-1.5 text-amber-500">· slow mover</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={sb.tone}>{sb.label}</Badge>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">{p.stockQty}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{p.minStock}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{fmtCurrency(p.unitCost)}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{fmtCurrency(p.sellingPrice)}</td>
                        <td className="px-3 py-3 text-right">{fmtNumber(p.predictedWeekly)}</td>
                        <td className="px-3 py-3 text-right text-slate-500">{p.daysCover == null ? "—" : `${p.daysCover}d`}</td>
                        <td className={"px-3 py-3 text-right font-semibold " + (p.suggested > 0 ? "text-brand-600 dark:text-brand-400" : "text-slate-400")}>
                          {p.suggested > 0 ? `+${p.suggested}` : "—"}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => openRestock(p)} title="Record restock" aria-label={`Record restock for ${p.name}`} className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10">
                              <PackagePlus className="h-4 w-4" />
                            </button>
                            <button onClick={() => loadHistory(p)} title="Stock history" aria-label={`View stock history for ${p.name}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
                              <RefreshCcw className="h-4 w-4" />
                            </button>
                            <button onClick={() => openEdit(p)} title="Edit product" aria-label={`Edit ${p.name}`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setTarget(p);
                                setModal("delete");
                              }}
                              title="Delete"
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card title="Stock history" sub={historyFor ? `${historyFor.name} — restocks, adjustments and imports` : "Pick a product's History (refresh icon) to see its stock ledger"} pad={false}>
          {!historyFor ? (
            <div className="p-5">
              <EmptyState icon={<RefreshCcw className="h-5 w-5" />} title="Select a product" desc="Use the history icon on any product row to open its stock ledger here." />
            </div>
          ) : history.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<RefreshCcw className="h-5 w-5" />} title="No transactions yet" desc="Restocks, manual adjustments and inventory imports will be recorded here." />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge tone={h.type === "restock" ? "success" : h.type === "adjustment" ? "warning" : "neutral"}>{h.type}</Badge>
                  <span className={"font-display text-sm font-bold " + (h.qtyChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
                    {h.qtyChange >= 0 ? "+" : ""}
                    {h.qtyChange}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-500">{h.note ?? ""}</span>
                  <span className="text-xs text-slate-400">{new Date(h.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Add / edit */}
      {(modal === "add" || modal === "edit") && (
        <Modal open onClose={() => setModal(null)} title={modal === "add" ? "Add product" : `Edit ${target?.name}`}>
          <div className="space-y-4">
            <Field label="Product name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Field>
              <Field label="Min stock level">
                <Input type="number" min={0} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
              </Field>
              <Field label="Unit cost">
                <Input type="number" min={0} step="0.01" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} />
              </Field>
              <Field label="Selling price">
                <Input type="number" min={0} step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
              </Field>
            </div>
            {modal === "edit" && (
              <Field label="Stock quantity">
                <Input type="number" min={0} value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} />
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={submitProduct} loading={busy}>{modal === "add" ? "Add product" : "Save changes"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Restock */}
      {modal === "restock" && target && (
        <Modal open onClose={() => setModal(null)} title={`Restock ${target.name}`}>
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              Current stock {target.stockQty} · forecast {fmtNumber(target.predictedWeekly)}/week · suggested order{" "}
              <strong className="text-brand-600 dark:text-brand-400">+{target.suggested}</strong>
            </p>
            <Field label="Quantity received">
              <Input type="number" min={1} value={restockQty} onChange={(e) => setRestockQty(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={doRestock} loading={busy}>Record restock</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete */}
      {modal === "delete" && target && (
        <Modal open onClose={() => setModal(null)} title="Delete product?">
          <p className="text-sm text-slate-500">
            <strong className="text-slate-800 dark:text-slate-200">{target.name}</strong> will be removed from your catalog and its stock ledger will be cleared. Past sales are kept.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} loading={busy}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
