"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCurrency } from "@/lib/utils";

type Day = { date: string; low: number; mid: number; high: number };

const AXIS = { fontSize: 13, fill: "#4a4a4a" };

/** Projected cash: the expected path with a low and a high case. The zero line is the one that matters. */
export function CashChart({ days, crunchDate }: { days: Day[]; crunchDate?: string | null }) {
  const data = days.map((d) => ({ label: d.date.slice(5), date: d.date, band: [d.low, d.high] as [number, number], mid: d.mid, low: d.low, high: d.high }));
  return (
    <div role="img" aria-label={`Projected cash over ${days.length} days. Expected ${fmtCurrency(days[days.length - 1]?.mid ?? 0)} at the end.${crunchDate ? ` Cash may run out around ${crunchDate}.` : ""}`}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cashBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4560f" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f4560f" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={6} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => fmtCurrency(v, true)} />
          <Tooltip
            contentStyle={{ backgroundColor: "#ffffff", border: "none", borderRadius: 12, boxShadow: "0 12px 30px -12px rgba(0,0,0,0.3)", color: "#111111", fontSize: 14, padding: "8px 12px" }}
            formatter={(_v, name, item) => {
              const p = item.payload as { low: number; mid: number; high: number };
              return name === "band" ? [`${fmtCurrency(p.low)} to ${fmtCurrency(p.high)}`, "Low to high case"] : [fmtCurrency(p.mid), "Expected"];
            }}
            labelFormatter={(l) => String(l)}
          />
          <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Out of cash", position: "insideBottomRight", fill: "#ef4444", fontSize: 13 }} />
          {crunchDate && <ReferenceLine x={crunchDate.slice(5)} stroke="#f59e0b" strokeDasharray="3 3" />}
          <Area type="monotone" dataKey="band" stroke="none" fill="url(#cashBand)" name="band" isAnimationActive={false} />
          <Area type="monotone" dataKey="mid" stroke="#f4560f" strokeWidth={2.4} fill="none" name="mid" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
