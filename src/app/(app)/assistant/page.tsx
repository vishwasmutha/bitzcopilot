"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, MessageSquareText, PenSquare, Plus, Send, Sparkles, Trash2, User } from "lucide-react";
import { Badge, Button, Card, Spinner, useToast } from "@/components/ui";
import { Md } from "@/components/ui";
import { BarsChart, DonutChart, TrendArea } from "@/components/charts";

type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  engine?: string | null;
  charts?: { kind: "bars" | "line" | "pie"; title: string; data: { label: string; value: number }[] }[] | null;
};

type Conv = { id: string; title: string; createdAt: Date | string };

const SUGGESTIONS = [
  "What was my total revenue last month?",
  "Which products are my best performers?",
  "Why have my sales declined?",
  "Which products should I restock?",
  "How can I increase my revenue?",
  "Which customers have stopped purchasing?",
  "What marketing strategy should I use this week?",
  "Predict my revenue for next week",
];

function ChartView({ chart }: { chart: NonNullable<Msg["charts"]>[number] }) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-2 px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{chart.title}</p>
      {chart.kind === "bars" && <BarsChart data={chart.data} height={190} horizontal={chart.data.length > 3} />}
      {chart.kind === "line" && <TrendArea data={chart.data} height={190} />}
      {chart.kind === "pie" && <DonutChart data={chart.data} height={170} />}
    </div>
  );
}

export default function AssistantPage() {
  const { push } = useToast();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai/conversations")
      .then((r) => r.json())
      .then((j) => setConvs(j.conversations ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const openConv = async (id: string) => {
    setActive(id);
    setMsgs([]);
    const r = await fetch(`/api/ai/conversations/${id}`);
    const j = await r.json();
    if (r.ok) setMsgs(j.messages ?? []);
  };

  const newConv = () => {
    setActive(null);
    setMsgs([]);
  };

  const deleteConv = async (id: string) => {
    await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
    setConvs((c) => c.filter((x) => x.id !== id));
    if (active === id) newConv();
    push({ title: "Conversation deleted", tone: "info" });
  };

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversationId: active }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMsgs((m) => [...m, { role: "assistant", content: `Sorry — ${j.error ?? "something went wrong"}. Please try again.` }]);
        return;
      }
      setMsgs((m) => [...m, { role: "assistant", content: j.reply, engine: j.engine, charts: j.charts }]);
      setActive(j.conversationId);
      fetch("/api/ai/conversations").then((rr) => rr.json()).then((jj) => setConvs(jj.conversations ?? [])).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bc-fade-up grid gap-4 lg:grid-cols-4" style={{ height: "calc(100vh - 150px)" }}>
      {/* Conversation list */}
      <Card className="hidden max-h-full flex-col lg:flex" title="Conversations" action={
        <button onClick={newConv} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10">
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      } pad={false}>
        <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {convs.length === 0 && <p className="px-4 py-8 text-center text-xs text-slate-400">No conversations yet — ask your first question.</p>}
          {convs.map((c) => (
            <div key={c.id} className={"group flex items-center gap-2 px-4 py-3 " + (active === c.id ? "bg-brand-50/60 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
              <button onClick={() => openConv(c.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-[13px] font-medium">{c.title}</p>
                <p className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</p>
              </button>
              <button onClick={() => deleteConv(c.id)} className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100" title="Delete conversation" aria-label={`Delete conversation ${c.title}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Chat */}
      <Card className="flex max-h-full flex-col overflow-hidden" pad={false}>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-600 text-white">
            <Bot className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="font-display text-sm font-semibold">BizCopilot Assistant</p>
            <p className="text-[11px] text-slate-400">Answers are computed from your business data — never invented.</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {msgs.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-accent-600 text-white shadow-lg">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold">Ask anything about your business</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
                  Revenue, products, stock, customers, forecasts — the assistant queries your actual database before answering.
                </p>
              </div>
              <div className="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-left text-[12.5px] text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-600 dark:hover:bg-brand-500/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={m.id ?? i} className={"flex gap-2.5 " + (m.role === "user" ? "justify-end" : "")}>
              {m.role === "assistant" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-600 text-white">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <div className={"max-w-[85%] " + (m.role === "user" ? "order-first" : "")}>
                <div
                  className={
                    "rounded-2xl px-4 py-3 " +
                    (m.role === "user"
                      ? "rounded-br-md bg-brand-600 text-white"
                      : "rounded-bl-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900")
                  }
                >
                  {m.role === "user" ? (
                    <p className="text-[13.5px] leading-relaxed">{m.content}</p>
                  ) : (
                    <>
                      <Md text={m.content} />
                      {m.charts?.map((ch, ci) => <ChartView key={ci} chart={ch} />)}
                    </>
                  )}
                </div>
                {m.role === "assistant" && m.engine && (
                  <div className="mt-1 flex items-center gap-1.5 px-1">
                    <Badge tone="accent" className="!px-1.5 !py-0 text-[10px]">{m.engine}</Badge>
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="flex gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-600 text-white">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Spinner label="Querying your data…" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
          <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/15 dark:border-slate-700 dark:bg-slate-900">
            <PenSquare className="mb-2.5 ml-1.5 h-4 w-4 shrink-0 text-slate-300" />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Ask about revenue, products, stock, customers…"
              className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
            />
            <Button onClick={() => send()} loading={busy} className="h-9">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 px-1 text-[10.5px] text-slate-400">
            <MessageSquareText className="h-3 w-3" /> Business-scoped · rate limited to 20 questions/min
          </p>
        </div>
      </Card>
    </div>
  );
}
