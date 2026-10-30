"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mic, Square, Zap } from "lucide-react";
import { Badge, Button, Card, Input, Select, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency } from "@/lib/utils";

type Item = { text: string; qty: number; status: "matched" | "ambiguous" | "unknown"; product: string | null; candidates: string[]; unitPrice: number | null; total: number | null };
type Preview = { items: Item[]; customer: string | null; onCredit: boolean; total: number; unresolved: number; ignored: string[] };

type Rec = { start: () => void; stop: () => void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

const LANGS = [
  { id: "en-IN", label: "English" },
  { id: "hi-IN", label: "हिंदी" },
  { id: "kn-IN", label: "ಕನ್ನಡ" },
];

/** "Sold 3 rice, 2 oil", typed or spoken. Shows what was understood before anything is recorded. */
export function QuickSale({ onDone }: { onDone: () => void }) {
  const { push } = useToast();
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-IN");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const rec = useRef<Rec | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const timer = window.setTimeout(() => setCanSpeak(!!(w.SpeechRecognition || w.webkitSpeechRecognition)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const call = async (commit: boolean, nextChoices = choices) => {
    setBusy(commit ? "commit" : "preview");
    setError(null);
    try {
      const r = await authFetch("/api/data/quick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, commit, choices: nextChoices, customer: preview?.customer ?? undefined, onCredit: preview?.onCredit }) });
      const j = await r.json().catch(() => ({}));
      if (j.items) setPreview(j);
      if (!r.ok) return setError(j.error ?? "Could not read that.");
      if (commit) {
        push({ title: "Sale recorded", desc: `${fmtCurrency(j.total)}${j.onCredit ? ", added to credit owed to you" : ""}. Stock was reduced.`, tone: "success" });
        setText("");
        setPreview(null);
        setChoices({});
        onDone();
      }
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const listen = () => {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) return rec.current?.stop();
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      setText(said);
      setPreview(null);
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setError("The microphone did not work. Type the sale instead.");
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const canCommit = preview && preview.items.length > 0 && preview.unresolved === 0;

  return (
    <Card title="Say or type what you sold" sub="For example: sold 3 rice, 2 oil. Add “to Ramesh on credit” and it also tracks what he owes. Recording also reduces stock.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="quick-sale" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); setError(null); }} placeholder="sold 3 rice, 2 oil" aria-label="What you sold" onKeyDown={(e) => e.key === "Enter" && text.trim().length >= 3 && call(false)} />
        {canSpeak && (
          <div className="flex gap-2">
            <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Speaking language" className="!w-28">
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
            <Button variant="outline" onClick={listen} aria-label={listening ? "Stop listening" : "Speak"}>
              {listening ? <Square className="h-4 w-4 text-red-500" /> : <Mic className="h-4 w-4" />}
            </Button>
          </div>
        )}
        <Button variant="outline" onClick={() => call(false)} loading={busy === "preview"} disabled={text.trim().length < 3 || busy !== null} className="shrink-0">
          <Zap className="h-4 w-4" /> Check
        </Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {preview && (
        <div className="mt-4 space-y-3 text-xs">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {preview.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-8 shrink-0 tabular-nums text-slate-500">{it.qty} ×</span>
                {it.status === "matched" && <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{it.product}</span>}
                {it.status === "ambiguous" && (
                  <Select value={choices[String(i)] ?? ""} onChange={(e) => { const next = { ...choices, [String(i)]: e.target.value }; setChoices(next); call(false, next); }} aria-label={`Which product is “${it.text}”?`} className="!h-8 min-w-0 flex-1 !text-xs">
                    <option value="">Which “{it.text}”?</option>
                    {it.candidates.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
                {it.status === "unknown" && <span className="min-w-0 flex-1 truncate text-amber-700 dark:text-amber-300">No product matches “{it.text}”</span>}
                <span className="tabular-nums">{it.total != null ? fmtCurrency(it.total) : "—"}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={preview.unresolved ? "warning" : "success"}>{preview.unresolved ? `${preview.unresolved} not matched` : `Total ${fmtCurrency(preview.total)}`}</Badge>
            {preview.customer && <Badge tone="neutral">{preview.customer}{preview.onCredit ? " · on credit" : ""}</Badge>}
            {preview.ignored.length > 0 && <Badge tone="warning">Ignored: {preview.ignored.join(", ")}</Badge>}
            {canCommit && (
              <Button size="sm" className="ml-auto" onClick={() => call(true)} loading={busy === "commit"} disabled={busy !== null}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Record this sale
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
