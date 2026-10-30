"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, HandCoins, Send, X } from "lucide-react";
import { Badge, Button, Card, Spinner, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type MsgLang = "en" | "hi" | "kn";
type Overdue = { itemId: string; party: string; amount: number; dueDate: string; daysOverdue: number; stage: 1 | 2 | 3; hasPhone: boolean; hold: string | null };
type Reminder = {
  id: string;
  itemId: string;
  party: string;
  amount: number;
  daysOverdue: number;
  stage: 1 | 2 | 3;
  stageLabel: string;
  status: "suggested" | "drafted" | "approved" | "received" | "dismissed";
  messages: Record<MsgLang, string> | null;
  waLinks: Record<MsgLang, string | null> | null;
  createdAt: string;
};
type View = {
  level: 1 | 2 | 3;
  overdueTotal: number;
  overdueCount: number;
  overdue: Overdue[];
  reminders: Reminder[];
  pending: number;
  recovered: { count: number; amount: number };
  cooldownDays: number;
};

const LANGS: { id: MsgLang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" },
  { id: "kn", label: "ಕನ್ನಡ" },
];

const DONE: Record<string, { label: string; tone: "success" | "neutral" | "info" }> = {
  approved: { label: "Marked as sent", tone: "info" },
  received: { label: "Collected", tone: "success" },
  dismissed: { label: "Skipped", tone: "neutral" },
};

export function CollectionsPanel({ onChange }: { onChange?: () => void }) {
  const { push } = useToast();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<MsgLang>("en");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/collections");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setView(j.view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load collections.");
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const draft = async () => {
    setBusy("draft");
    try {
      const r = await authFetch("/api/collections", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setView(j.view);
      push({ title: j.drafted ? `${j.drafted} reminder${j.drafted === 1 ? "" : "s"} drafted` : "No new reminders today", desc: j.drafted ? "Review them below, then send." : "Each customer gets at most one reminder per stage, spaced apart.", tone: j.drafted ? "success" : "info" });
    } catch (e) {
      push({ title: "Could not draft reminders", desc: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, decision: "sent" | "dismiss" | "collected") => {
    setBusy(id + decision);
    try {
      const r = await authFetch(`/api/collections/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setView(j.view);
      if (decision === "collected") {
        push({ title: "Marked as collected", desc: "It is off your open credit and the cash outlook is updated.", tone: "success" });
        onChange?.();
      }
    } catch (e) {
      push({ title: "Could not save", desc: e instanceof Error ? e.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const copy = async (r: Reminder) => {
    if (!r.messages) return;
    try {
      await navigator.clipboard.writeText(r.messages[lang]);
      setCopied(r.id);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      push({ title: "Could not copy", desc: "Select the text and copy it instead.", tone: "error" });
    }
  };

  if (error) return <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!view) return <Spinner label="Checking who owes you…" />;

  const ready = view.reminders.filter((r) => r.status === "drafted" || r.status === "suggested");
  const done = view.reminders.filter((r) => ["approved", "received", "dismissed"].includes(r.status)).slice(0, 6);
  const waiting = view.overdue.filter((o) => !ready.some((r) => r.itemId === o.itemId));

  return (
    <div id="collections" className="scroll-mt-24">
      <Card
        title="Collections"
        sub="Money customers owe you. Reminders are drafts: you send them, and nothing goes out automatically."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Message language" className="flex rounded-full bg-slate-100 p-1 text-sm">
              {LANGS.map((l) => (
                <button key={l.id} type="button" onClick={() => setLang(l.id)} aria-pressed={lang === l.id} className={"rounded-full px-3 py-1 font-medium " + (lang === l.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>
                  {l.label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={draft} loading={busy === "draft"}>
              <HandCoins className="h-4 w-4" /> Draft reminders
            </Button>
          </div>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Overdue</p>
            <p className="font-display mt-1.5 text-3xl font-bold text-slate-900">{fmtCurrency(view.overdueTotal)}</p>
            <p className="text-sm text-slate-500">from {view.overdueCount} customer{view.overdueCount === 1 ? "" : "s"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ready to send</p>
            <p className="font-display mt-1.5 text-3xl font-bold text-slate-900">{ready.length}</p>
            <p className="text-sm text-slate-500">reminder{ready.length === 1 ? "" : "s"} waiting for you</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Collected after a reminder</p>
            <p className="font-display mt-1.5 text-3xl font-bold text-slate-900">{fmtCurrency(view.recovered.amount)}</p>
            <p className="text-sm text-slate-500">{view.recovered.count} payment{view.recovered.count === 1 ? "" : "s"}. This shows what came in, not proof the reminder caused it.</p>
          </div>
        </div>

        {view.overdueCount === 0 && <p className="mt-6 rounded-2xl bg-slate-100 px-5 py-4 text-[15px] text-slate-600">Nobody is overdue. When credit you gave goes past its due date, polite reminders will appear here.</p>}

        {ready.length > 0 && (
          <ul className="mt-6 space-y-4">
            {ready.map((r) => {
              const link = r.waLinks?.[lang] ?? null;
              return (
                <li key={r.id} className="rounded-2xl bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-display text-lg font-semibold text-slate-900">{r.party}</p>
                    <span className="font-display text-lg font-bold text-slate-900">{fmtCurrency(r.amount)}</span>
                    <Badge tone={r.stage === 3 ? "warning" : "neutral"}>{r.stageLabel}</Badge>
                    <span className="text-sm text-slate-500">{r.daysOverdue} days overdue</span>
                  </div>
                  {r.messages ? (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl bg-white p-4 text-[15px] leading-7 text-slate-800">{r.messages[lang]}</p>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white p-4 text-sm text-slate-600">Autopilot is on “Suggest only”, so no message was prepared. Switch it to “Draft and wait” on the Autopilot page to get ready-to-send wording.</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {r.messages && (
                      <>
                        {link ? (
                          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600">
                            <ExternalLink className="h-4 w-4" /> Open in WhatsApp
                          </a>
                        ) : (
                          <span className="text-sm text-slate-500">No phone number on file, so copy the message instead.</span>
                        )}
                        <Button variant="outline" size="sm" onClick={() => copy(r)}>
                          {copied === r.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied === r.id ? "Copied" : "Copy"}
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" onClick={() => decide(r.id, "sent")} loading={busy === r.id + "sent"}>
                      <Send className="h-4 w-4" /> I sent it
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => decide(r.id, "collected")} loading={busy === r.id + "collected"}>
                      <Check className="h-4 w-4" /> They paid
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => decide(r.id, "dismiss")} loading={busy === r.id + "dismiss"}>
                      <X className="h-4 w-4" /> Skip
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {waiting.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Overdue, no new reminder yet</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {waiting.map((o) => (
                <li key={o.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-slate-900">{o.party}</span>
                  <span className="text-sm text-slate-500">{o.daysOverdue} days late</span>
                  <span className="w-24 text-right text-[15px] font-semibold tabular-nums">{fmtCurrency(o.amount)}</span>
                  <span className="basis-full text-sm text-slate-500 sm:basis-auto sm:w-64">{o.hold ?? "A reminder is due. Press Draft reminders."}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recent</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-slate-800">{r.party}</span>
                  <span className="text-sm text-slate-500">{r.stageLabel}</span>
                  <span className="w-24 text-right text-[15px] font-semibold tabular-nums">{fmtCurrency(r.amount)}</span>
                  <Badge tone={DONE[r.status].tone}>{DONE[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
