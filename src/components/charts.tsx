"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCurrency } from "@/lib/utils";

const AXIS = { fontSize: 13, fill: "#4a4a4a" };
const GRID = "rgba(0,0,0,0.06)";

function tick(v: number, prefix: string) {
  if (Math.abs(v) < 1000) return `${prefix}${Math.round(v)}`;
  return `${prefix}${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
}

function money(v: number) {
  return fmtCurrency(v, true);
}

function tooltipStyle() {
  return {
    backgroundColor: "#ffffff",
    border: "none",
    borderRadius: 12,
    boxShadow: "0 12px 30px -12px rgba(0,0,0,0.3)",
    color: "#111111",
    fontSize: 14,
    padding: "8px 12px",
  } as const;
}

export function TrendArea({
  data,
  height = 260,
  color = "#f4560f",
  dataKey = "value",
  name = "Revenue",
  prefix = "₹",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  dataKey?: string;
  name?: string;
  prefix?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${dataKey}-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => tick(v, prefix)} />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => [fmtCurrency(Number(v)), name]} labelStyle={{ color: "#52525b" }} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.4} fill={`url(#g-${dataKey}-${color})`} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data,
  height = 260,
  color = "#f4560f",
  horizontal = false,
  prefix = "₹",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  horizontal?: boolean;
  prefix?: string;
}) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => tick(v, prefix)} />
          <YAxis type="category" dataKey="label" tick={{ ...AXIS, fontSize: 13 }} tickLine={false} axisLine={false} width={120} />
          <Tooltip contentStyle={tooltipStyle()} formatter={(v) => [fmtCurrency(Number(v)), "Revenue"]} labelStyle={{ color: "#52525b" }} />
          <Bar dataKey="value" fill={color} radius={[0, 8, 8, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => tick(v, prefix)} />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => [fmtCurrency(Number(v)), "Revenue"]} labelStyle={{ color: "#52525b" }} cursor={{ fill: "rgba(17,17,17,0.06)" }} />
        <Bar dataKey="value" fill={color} radius={[10, 10, 10, 10]} maxBarSize={30} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = ["#f4560f", "#3a2415", "#e8e2d6", "#fb9a6b", "#9a8f80", "#ffc7a6", "#cfc8bb"];

export function DonutChart({ data, height = 240 }: { data: { label: string; value: number }[]; height?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
      <ResponsiveContainer width="100%" height={height} className="max-w-[240px] shrink-0">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="#ffffff" strokeWidth={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle()} formatter={(v) => [fmtCurrency(Number(v)), ""]} labelStyle={{ color: "#52525b" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="w-full min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
            <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="font-medium text-slate-900 dark:text-white">{money(d.value)}</span>
            <span className="w-10 text-right text-xs text-slate-400">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompareBars({
  data,
  height = 260,
}: {
  data: { label: string; current: number; previous: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `${money(v)}`} />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v, n) => [fmtCurrency(Number(v)), n === "current" ? "This month" : "Previous"]} labelStyle={{ color: "#52525b" }} cursor={{ fill: "rgba(17,17,17,0.06)" }} />
        <Bar dataKey="previous" fill="#e8e2d6" radius={[8, 8, 8, 8]} maxBarSize={22} />
        <Bar dataKey="current" fill="#f4560f" radius={[8, 8, 8, 8]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Forecast: history (actual + model fit) + forecast band */
export function ForecastChart({
  data,
  height = 300,
}: {
  data: { label: string; actual?: number; fit?: number; predicted?: number; lower?: number; upper?: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fc-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4560f" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#f4560f" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `${money(v)}`} />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v: any, n: any) => (n === "band" ? [fmtCurrency(Number(v)), "Band"] : [fmtCurrency(Number(v)), n === "actual" ? "Actual" : n === "fit" ? "Model fit" : "Predicted"])}
          labelStyle={{ color: "#52525b" }}
        />
        <Area dataKey="lower" stackId="band" stroke="none" fill="transparent" legendType="none" name="_lo" />
        <Area dataKey="upper" stackId="band" stroke="none" fill="url(#fc-band)" name="band" legendType="none" />
        <Line type="monotone" dataKey="actual" stroke="#111111" strokeWidth={2.4} dot={false} name="actual" />
        <Line type="monotone" dataKey="fit" stroke="#71717a" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="fit" />
        <Line type="monotone" dataKey="predicted" stroke="#f4560f" strokeWidth={2.6} dot={false} name="predicted" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MiniLine({ data, color = "#f4560f", height = 100 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={30} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${money(v)}`} />
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => [fmtCurrency(Number(v)), ""]} labelStyle={{ color: "#52525b" }} />
        <Line type="monotone" dataKey="value" stroke="#f4560f" strokeWidth={2.4} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
