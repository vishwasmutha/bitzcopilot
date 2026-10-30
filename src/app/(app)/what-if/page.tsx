"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { MathReceipt, type ReceiptData } from "@/components/receipt";
import { Button, Card, PageHeader } from "@/components/ui";
import { fmtCurrency } from "@/lib/utils";
import { authFetch } from "@/lib/client-auth";

const EXAMPLES = [
  "What if I raise oil by ₹5?",
  "What if I run 10% off on weekends?",
  "What if my supplier delays a week?",
  "अगर तेल ₹5 बढ़ा दूं?",
  "ಎಣ್ಣೆ ₹5 ಹೆಚ್ಚಿಸಿದರೆ?",
];

type Result = {
  status: string;
  summary: string;
  low: number | null;
  high: number | null;
  point: number | null;
  unit: string;
  receipt: ReceiptData;
};

export default function WhatIfPage() {
  const [q, setQ] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (question = q) => {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch("/api/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await r.json();
      if (!r.ok) return setError(j.error ?? "Could not run that.");
      setResult(j);
    } finally {
      setBusy(false);
    }
  };

  const span = result && result.low != null && result.high != null ? Math.max(1, result.high) : 1;

  return (
    <div className="bc-fade-up mx-auto max-w-3xl">
      <PageHeader
        title="What if?"
        desc="Price, discount, and delay questions are answered from this shop’s own history. The range is regression uncertainty or observed sales spread. If the history can’t support a number, it is withheld."
      />
      <Card>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => { setQ(e); run(e); }} className="rounded-full border border-slate-200 px-3 py-1 text-[12px] hover:border-brand-400 dark:border-slate-700">
              {e}
            </button>
          ))}
        </div>
        <Button className="mt-4" onClick={() => run()} loading={busy}>
          <FlaskConical className="h-4 w-4" /> Run on my data
        </Button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>
      {result && (
        <Card className="mt-4" title={result.receipt.title} sub={result.unit || result.status}>
          <p className="text-sm leading-relaxed">{result.summary}</p>
          {result.low != null && result.high != null && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>{fmtCurrency(result.low)}</span>
                <span>{result.point != null ? `point ${fmtCurrency(result.point)}` : "no point estimate"}</span>
                <span>{fmtCurrency(result.high)}</span>
              </div>
              <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="absolute top-0 h-3 rounded-full bg-brand-500/80"
                  style={{
                    left: `${(result.low / span) * 100}%`,
                    width: `${Math.max(4, ((result.high - result.low) / span) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          <MathReceipt receipt={result.receipt} />
        </Card>
      )}
    </div>
  );
}
