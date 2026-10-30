"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardPaste } from "lucide-react";
import { Badge, Button, Card, Textarea, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";
import { fmtCurrency, shortDate } from "@/lib/utils";

type Preview = {
  found: number;
  toImport: number;
  duplicates: number;
  debitsIgnored: number;
  total: number;
  skipped: { line: number; text: string; reason: string }[];
  sample: { date: string; amount: number; party: string }[];
  committed?: boolean;
};

const EXAMPLE = `12/10/2026 Rs. 450 received from Ramesh Kumar via UPI
13 Oct 2026 UPI credited ₹1,250.50 from Lakshmi Stores
14-10-2026 Paid to Wholesaler Rs 5000`;

export function UpiImport({ onDone }: { onDone: () => void }) {
  const { push } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (commit: boolean) => {
    setBusy(commit ? "commit" : "preview");
    setError(null);
    try {
      const r = await authFetch("/api/data/upi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, commit }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.found != null) setPreview(j);
        setError(j.error ?? "Could not read that text.");
        return;
      }
      setPreview(j);
      if (commit) {
        push({ title: "UPI receipts imported", desc: `${j.toImport} payments, ${fmtCurrency(j.total)}.`, tone: "success" });
        setText("");
        onDone();
      }
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="No spreadsheet? Paste your UPI or bank messages" sub="Money received becomes sales. Payments you made are ignored. Nothing is imported until you confirm.">
      <Textarea
        id="upi-text"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
          setError(null);
        }}
        placeholder={EXAMPLE}
        className="font-mono text-xs"
        aria-label="Pasted UPI or bank statement lines"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => call(false)} loading={busy === "preview"} disabled={text.trim().length < 8 || busy !== null}>
          <ClipboardPaste className="h-3.5 w-3.5" /> Check what it finds
        </Button>
        {preview && !preview.committed && preview.toImport > 0 && (
          <Button size="sm" onClick={() => call(true)} loading={busy === "commit"} disabled={busy !== null}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Import {preview.toImport} payment{preview.toImport === 1 ? "" : "s"}
          </Button>
        )}
        <button type="button" className="ml-auto text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => { setText(EXAMPLE); setPreview(null); setError(null); }}>
          Try an example
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {preview && (
        <div className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{preview.toImport} to import · {fmtCurrency(preview.total)}</Badge>
            {preview.duplicates > 0 && <Badge tone="neutral">{preview.duplicates} already imported</Badge>}
            {preview.debitsIgnored > 0 && <Badge tone="neutral">{preview.debitsIgnored} payments out ignored</Badge>}
            {preview.skipped.length > 0 && <Badge tone="warning">{preview.skipped.length} lines not understood</Badge>}
          </div>
          {preview.sample.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {preview.sample.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-slate-500">{shortDate(s.date)}</span>
                  <span className="flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{s.party}</span>
                  <span className="tabular-nums">{fmtCurrency(s.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.skipped.length > 0 && (
            <ul className="space-y-1 text-slate-500">
              {preview.skipped.slice(0, 5).map((s) => (
                <li key={s.line}>
                  Line {s.line}: {s.reason}. <span className="font-mono opacity-70">{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
