"use client";

import { useState } from "react";
import { Link2, Plug } from "lucide-react";
import { Badge, Button, Card, Input, useToast } from "./ui";
import { authFetch } from "@/lib/client-auth";

const ROADMAP = ["Shopify", "Square", "Tally", "Zoho Books"];

/** Google Sheets works today through a share link. The others are on the roadmap. */
export function ConnectorsCard({ onFile }: { onFile: (f: File) => void }) {
  const { push } = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pull = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch("/api/data/sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Could not read that sheet.");
        return;
      }
      onFile(new File([j.csv], j.fileName ?? "google-sheet.csv", { type: "text/csv" }));
      push({ title: "Sheet loaded", desc: "Check the column mapping below, then import.", tone: "success" });
    } catch {
      setError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Connect a Google Sheet" sub="Keep your sales in a sheet? Paste its link. It must be shared as “Anyone with the link can view”.">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="sheet-url" value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Google Sheet link" />
        <Button onClick={pull} loading={busy} disabled={url.trim().length < 20 || busy} className="shrink-0">
          <Link2 className="h-4 w-4" /> Load sheet
        </Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <Plug className="h-3.5 w-3.5" /> Live connectors, on the roadmap:
        {ROADMAP.map((n) => (
          <Badge key={n} tone="neutral">{n}</Badge>
        ))}
      </div>
    </Card>
  );
}
