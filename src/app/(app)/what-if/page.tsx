"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FlaskConical } from "lucide-react";
import { MathReceipt, type ReceiptData } from "@/components/receipt";
import { Button, Card, PageHeader } from "@/components/ui";
import { fmtCurrency } from "@/lib/utils";
import { authFetch } from "@/lib/client-auth";

const SUGGESTIONS = [
  "What if I raise the price of my best seller by 5%?",
  "What if I give 10% off this weekend?",
  "What if demand for my most popular service increases?",
  "What if my supplier is 7 days late?",
  "What if I extend my opening hours?",
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
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; result?: Result }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const run = async (event?: FormEvent<HTMLFormElement>, suggestedQuestion?: string) => {
    event?.preventDefault();
    const question = (suggestedQuestion ?? q).trim();
    if (!question || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: question }]);
    setQ("");
    setError(null);
    setBusy(true);
    try {
      const r = await authFetch("/api/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "Could not analyze that scenario.");
        setMessages((current) => current.slice(0, -1));
        return;
      }
      setMessages((current) => [...current, { role: "assistant", content: j.summary, result: j }]);
    } finally {
      setBusy(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void run();
    }
  };

  return (
    <div className="bc-fade-up max-w-4xl">
      <PageHeader
        title="What if?"
        desc="Explore pricing, demand, staffing, service capacity, promotions, suppliers, or another business scenario. Numbers appear only when your records support them; otherwise the assistant explains how to test the idea."
      />
      <Card className="flex min-h-[min(640px,calc(100vh-260px))] flex-col" pad={false}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6" aria-live="polite">
          {messages.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <FlaskConical className="h-6 w-6" />
              </span>
              <h2 className="font-display text-xl font-semibold">Explore a business scenario</h2>
              <p className="mt-2 max-w-md text-[15px] text-slate-500">Ask a specific question. Follow up to compare options or clarify assumptions.</p>
              <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void run(undefined, suggestion)}
                    disabled={busy}
                    className="rounded-full bg-slate-100 px-4 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              const result = message.result;
              const span = result?.low != null && result.high != null ? Math.max(1, Math.abs(result.low), Math.abs(result.high)) : 1;
              return (
                <div key={`${message.role}-${index}`} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={message.role === "user" ? "max-w-[88%] rounded-3xl rounded-br-lg bg-slate-900 px-5 py-3.5 text-[15px] text-white" : "w-full max-w-[94%] rounded-3xl rounded-bl-lg bg-slate-100 px-5 py-4 text-[15px] text-slate-900"}>
                    <p className="whitespace-pre-wrap leading-7">{message.content}</p>
                    {result && (
                      <div className="mt-4 rounded-2xl bg-white p-4">
                        <p className="font-display text-base font-semibold">{result.receipt.title}</p>
                        <p className="mt-0.5 text-sm text-slate-500">{result.unit || result.status}</p>
                        {result.low != null && result.high != null && (
                          <div className="mt-3">
                            <div className="mb-1.5 flex justify-between gap-2 text-sm text-slate-600">
                              <span>{fmtCurrency(result.low)}</span>
                              <span>{result.point != null ? `point ${fmtCurrency(result.point)}` : "no point estimate"}</span>
                              <span>{fmtCurrency(result.high)}</span>
                            </div>
                            <div className="relative h-3 rounded-full bg-slate-200">
                              <div
                                className="absolute top-0 h-3 rounded-full bg-brand-500"
                                style={{
                                  left: `${Math.max(0, Math.min(96, (Math.min(result.low, result.high) / span) * 100))}%`,
                                  width: `${Math.max(4, Math.min(100, (Math.abs(result.high - result.low) / span) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                        <MathReceipt receipt={result.receipt} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {busy && <p className="text-[15px] text-slate-500">Checking your data and scenario…</p>}
          <div ref={endRef} />
        </div>
        <form onSubmit={(event) => void run(event)} className="border-t border-slate-100 p-4">
          {error && <p className="mb-2 px-2 text-[15px] text-red-600" role="alert">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={2}
              maxLength={2000}
              aria-label="Ask a business what-if question"
              placeholder="Ask about pricing, demand, staffing, services, promotions, suppliers…"
              className="min-h-12 max-h-32 flex-1 resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <Button type="submit" disabled={!q.trim()} loading={busy} aria-label="Send scenario question">
              <FlaskConical className="h-4 w-4" /> Analyze
            </Button>
          </div>
          <p className="mt-2 px-1 text-xs text-slate-500">Enter to send · Shift+Enter for a new line · unsupported impacts are not guessed</p>
        </form>
      </Card>
    </div>
  );
}
