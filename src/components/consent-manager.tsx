"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { Badge, Button, Card, Input, Spinner, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type C = { refId: string; name: string | null; phone: string | null; consent: boolean; consentAt: string | null; consentSource: string | null; orders: number; spent: number; lastPurchaseAt: string | null };

/** Marketing consent register. A customer is messaged only if the shop holds their opt-in. */
export function ConsentManager() {
  const { push } = useToast();
  const [rows, setRows] = useState<C[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("agreed at the counter");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      authFetch("/api/consent")
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not load.");
          setRows(j.customers);
        })
        .catch((e: Error) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => !t || (c.name ?? "").toLowerCase().includes(t) || c.refId.toLowerCase().includes(t) || (c.phone ?? "").includes(t)).slice(0, 60);
  }, [rows, q]);

  const set = async (refIds: string[], consent: boolean) => {
    setBusy(true);
    try {
      const r = await authFetch("/api/consent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refIds, consent, source: source.trim() || "recorded by owner" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not update", desc: j.error, tone: "error" });
      push({ title: consent ? "Consent recorded" : "Consent withdrawn", desc: `${j.updated} customer${j.updated === 1 ? "" : "s"} updated.`, tone: "success" });
      setPicked(new Set());
      load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Card title="Marketing consent"><p className="text-sm text-red-600">{error}</p></Card>;
  if (!rows) return <Card title="Marketing consent"><Spinner /></Card>;
  const agreed = rows.filter((c) => c.consent).length;

  return (
    <Card title="Marketing consent" sub="Messages are drafted only for customers who agreed to hear from you. Record consent only when you really hold it.">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="success"><ShieldCheck className="h-3 w-3" /> {agreed} of {rows.length} agreed</Badge>
        <div className="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Input id="consent-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search customers" className="sm:w-52" />
          <Input id="consent-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="How did they agree?" aria-label="How did they agree" className="sm:w-56" />
        </div>
      </div>
      {picked.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs dark:bg-brand-500/10">
          <span className="font-medium">{picked.size} selected</span>
          <Button size="sm" onClick={() => set([...picked], true)} loading={busy} disabled={busy}>
            <Check className="h-3.5 w-3.5" /> They agreed
          </Button>
          <Button size="sm" variant="outline" onClick={() => set([...picked], false)} disabled={busy}>
            <X className="h-3.5 w-3.5" /> Withdraw
          </Button>
          <button type="button" className="ml-auto text-slate-500 hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-500 dark:bg-slate-900">
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((c) => picked.has(c.refId))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((c) => c.refId)) : new Set())} />
              </th>
              <th className="px-2 py-2 font-medium">Customer</th>
              <th className="px-2 py-2 font-medium">Phone</th>
              <th className="px-2 py-2 text-right font-medium">Spent</th>
              <th className="px-3 py-2 font-medium">Consent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((c) => (
              <tr key={c.refId}>
                <td className="px-3 py-2">
                  <input type="checkbox" aria-label={`Select ${c.name ?? c.refId}`} checked={picked.has(c.refId)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.refId); else n.delete(c.refId); return n; })} />
                </td>
                <td className="px-2 py-2">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{c.name ?? c.refId}</span>
                  <span className="ml-1.5 text-slate-400">{c.orders} orders</span>
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-500">{c.phone ?? "none"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtCurrency(c.spent, true)}</td>
                <td className="px-3 py-2">
                  {c.consent ? <Badge tone="success" className="!text-xs" >{c.consentSource ?? "agreed"}</Badge> : <span className="text-slate-400">not recorded</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">No customers match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 60 && <p className="mt-2 text-xs text-slate-400">Showing the first 60 matches. Search to narrow the list.</p>}
    </Card>
  );
}
