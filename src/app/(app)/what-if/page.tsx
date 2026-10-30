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
    <div className="bc-fade-up mx-auto max-w-3xl">
      <PageHeader
        title="What if?"
        desc="Explore pricing, demand, staffing, service capacity, promotions, suppliers, or another business scenario. Numbers appear only when your records support them; otherwise the assistant explains how to test the idea."
      />
      <Card className="flex min-h-[min(620px,calc(100vh-230px))] flex-col" pad={false}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
          {messages.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                <FlaskConical className="h-5 w-5" />
              </span>
              <h2 className="font-display text-base font-semibold">Explore a business scenario</h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">Ask a specific question. Follow up to compare options or clarify assumptions.</p>
              <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void run(undefined, suggestion)}
                    disabled={busy}
                    className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-left text-xs text-violet-800 transition-colors hover:bg-violet-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800"
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
                  <div className={message.role === "user" ? "max-w-[88%] rounded-xl rounded-br-sm bg-violet-700 px-4 py-3 text-sm text-white" : "w-full max-w-[94%] rounded-xl rounded-bl-sm bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100"}>
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    {result && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <p className="font-medium">{result.receipt.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{result.unit || result.status}</p>
                        {result.low != null && result.high != null && (
                          <div className="mt-3">
                            <div className="mb-1 flex justify-between gap-2 text-xs text-slate-500">
                              <span>{fmtCurrency(result.low)}</span>
                              <span>{result.point != null ? `point ${fmtCurrency(result.point)}` : "no point estimate"}</span>
                              <span>{fmtCurrency(result.high)}</span>
                            </div>
                            <div className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className="absolute top-0 h-2.5 rounded-full bg-violet-600/80"
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
          {busy && <p className="text-sm text-slate-500">Checking your data and scenario…</p>}
          <div ref={endRef} />
        </div>
        <form onSubmit={(event) => void run(event)} className="border-t border-slate-200 p-3 dark:border-slate-800">
          {error && <p className="mb-2 px-2 text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={2}
              maxLength={2000}
              aria-label="Ask a business what-if question"
              placeholder="Ask about pricing, demand, staffing, services, promotions, suppliers…"
              className="min-h-11 max-h-32 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950"
            />
            <Button type="submit" disabled={!q.trim()} loading={busy} aria-label="Send scenario question">
              <FlaskConical className="h-4 w-4" /> Analyze
            </Button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line · unsupported impacts are not guessed</p>
        </form>
      </Card>
    </div>
  );
}
