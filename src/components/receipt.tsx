"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";

export type ReceiptData = {
  title: string;
  status: "computed" | "insufficient";
  headline: string;
  steps: { label: string; detail: string }[];
  caveat?: string;
};

export function MathReceipt({ receipt, dark = false }: { receipt: ReceiptData; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const withheld = receipt.status === "insufficient";
  return (
    <div className={"mt-2 rounded-md text-left " + (dark ? "bg-black/30" : "bg-slate-50 dark:bg-slate-800/60")}>
      <button type="button" onClick={() => setOpen(!open)} className={"flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold " + (dark ? "text-[#25D366]" : "text-brand-700 dark:text-brand-300")}>
        <Calculator className="h-3.5 w-3.5" />
        {open ? "Hide the math" : "Show the math"}
        <span className={"ml-auto rounded-full px-1.5 py-0.5 text-[10px] " + (withheld ? "bg-amber-500/20 text-amber-300" : dark ? "bg-white/10 text-white/70" : "bg-emerald-100 text-emerald-700")}>
          {withheld ? "Not enough history" : "Computed"}
        </span>
      </button>
      {open && (
        <div className={"space-y-1.5 px-2.5 pb-2.5 text-[11.5px] leading-snug " + (dark ? "text-white/80" : "text-slate-600 dark:text-slate-300")}>
          <p className="font-medium">{receipt.headline}</p>
          {receipt.steps.map((s) => (
            <p key={s.label}>
              <span className="font-semibold">{s.label}. </span>
              {s.detail}
            </p>
          ))}
          {receipt.caveat && <p className="text-[11px] opacity-70">{receipt.caveat}</p>}
        </div>
      )}
    </div>
  );
}
