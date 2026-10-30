"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BrainCircuit,
  Database,
  Layers,
  LineChart,
  Megaphone,
  MessageSquareText,
  Store,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui";
import { goSignedIn } from "@/lib/client-auth";

const FEATURES = [
  {
    icon: BarChart3,
    title: "Live analytics dashboard",
    desc: "Revenue, orders, AOV, inventory value and customer activity — computed from your own imported data, never estimates.",
  },
  {
    icon: Database,
    title: "Excel & CSV ingestion",
    desc: "Upload sales, products, inventory or customer files. Columns auto-detected, mappable, validated, de-duplicated and normalised.",
  },
  {
    icon: LineChart,
    title: "ML sales forecasting",
    desc: "Regression and Holt-Winters models pick the best fit on a holdout test. 7/30-day revenue forecasts with confidence bands.",
  },
  {
    icon: MessageSquareText,
    title: "BizCopilot assistant",
    desc: "Ask in plain English — “why did sales drop?” Answers are grounded in database queries, with charts attached. No invented numbers.",
  },
  {
    icon: Layers,
    title: "Smart inventory",
    desc: "Low-stock and stockout alerts, slow-mover detection and demand-based reorder quantities tied to your forecast.",
  },
  {
    icon: Megaphone,
    title: "AI marketing studio",
    desc: "Instagram, WhatsApp, email and win-back copy generated around your real trends — saved, editable, never auto-sent.",
  },
  {
    icon: Users,
    title: "RFM customer segments",
    desc: "Loyal, high-value, at-risk and lapsed customers identified automatically, each with a suggested play.",
  },
  {
    icon: Bell,
    title: "Business alerts",
    desc: "Sales drops, surging demand and engagement decline surface proactively in the notification centre.",
  },
];

const STEPS = [
  { n: "01", title: "Create your business", desc: "Sign up, pick your category and tell us about your shop in two minutes." },
  { n: "02", title: "Bring your data", desc: "Upload the CSV or Excel exports from your POS or spreadsheets — or load the demo dataset to explore first." },
  { n: "03", title: "Ask your copilot", desc: "Get dashboards, forecasts, reorder plans and marketing copy built on your numbers." },
];

const CATS = ["Bakeries", "Restaurants", "Grocery stores", "Retail shops", "Clothing stores", "Local services"];

export default function Landing() {
  const [demoBusy, setDemoBusy] = useState(false);
  const startDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await fetch("/api/auth/demo", { method: "POST", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.token) goSignedIn(j.token, "/dashboard");
      else alert(j.error ?? "Not authenticated — demo sign-in did not return a session.");
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[17px] font-bold tracking-tight">BizCopilot</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex dark:text-slate-300">
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white">Features</a>
            <a href="#how" className="hover:text-slate-900 dark:hover:text-white">How it works</a>
            <a href="#categories" className="hover:text-slate-900 dark:hover:text-white">For your business</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-950 text-white">
        <div className="bg-grid-navy absolute inset-0" />
        <div className="absolute -top-32 right-0 h-96 w-96 rounded-full bg-brand-600/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-accent-600/15 blur-[110px]" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-28">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-brand-200">
              <Store className="h-3.5 w-3.5" /> Built for small business owners, not analysts
            </div>
            <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              Your business,
              <br />
              clearly in view.
              <br />
              <span className="text-[#25D366]">Your next move, backed by data.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-300">
              See sales, customers, forecasts, products or services in one practical dashboard. Built for retailers,
              salons and local service businesses, with WhatsApp briefs available whenever you need them.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" loading={demoBusy} onClick={startDemo}>
                Explore the business dashboard <ArrowRight className="h-4 w-4" />
              </Button>
              <Link href="/wa">
                <Button size="lg" variant="outline" className="border-white/25 text-white hover:bg-white/10">
                  WhatsApp brief
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">Includes sales trends, customer activity, forecasts, and operations tools. WhatsApp is available as a separate workspace view.</p>
          </div>

          {/* Product mock */}
          <div className="relative">
            <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-4 shadow-2xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">Annapurna Kirana · Jayanagar</p>
                  <p className="font-display text-sm font-semibold">9:00 AM brief</p>
                </div>
                <span className="rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[11px] font-medium text-[#25D366]">WhatsApp</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: "Revenue", v: "$18,420" },
                  { k: "Orders", v: "1,204" },
                  { k: "Forecast 7d", v: "$4,310" },
                ].map((s) => (
                  <div key={s.k} className="rounded-lg bg-white/5 p-3">
                    <p className="text-[10px] text-slate-400">{s.k}</p>
                    <p className="font-display text-base font-bold">{s.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg bg-white/5 p-3">
                <p className="mb-2 text-[10px] text-slate-400">Daily revenue</p>
                <div className="flex h-24 items-end gap-1">
                  {[38, 42, 40, 47, 52, 44, 39, 55, 61, 58, 64, 50, 46, 52, 68, 74, 70, 76, 62, 58, 66, 72, 78, 74, 82, 60, 65, 70].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-brand-600 to-brand-400" style={{ height: `${h}%`, opacity: 0.55 + (i / 60) }} />
                  ))}
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-100">
                Rice will run out in 3 days. Weekday sales are down 18%.
                <span className="mt-1 block font-semibold text-[#25D366]">Approve promo →</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Made for</span>
          {CATS.map((c) => (
            <span key={c} className="font-medium">{c}</span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto mb-12 max-w-xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight">Every decision, backed by your numbers</h2>
          <p className="mt-3 text-[15px] text-slate-500 dark:text-slate-400">
            No dashboards of random numbers. Every figure, forecast and recommendation is computed from the data you upload.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300">
                <f.icon className="h-4.5 w-4.5" />
              </div>
              <h3 className="font-display text-[15px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-slate-200 bg-navy-950 py-20 text-white dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display mb-12 text-center text-3xl font-bold tracking-tight">Live in an afternoon</h2>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-xl border border-white/10 bg-white/5 p-6">
                <span className="font-display text-sm font-bold text-brand-400">{s.n}</span>
                <h3 className="font-display mt-3 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-14 flex flex-col items-center gap-4 text-center">
            <p className="flex items-center gap-2 text-sm text-slate-300">
              <TrendingUp className="h-4 w-4 text-emerald-400" /> The assistant never invents financial figures — ask it anything, it will only answer from your database.
            </p>
            <Link href="/signup">
              <Button size="lg">
                Create your workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-slate-400 sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-display font-semibold text-slate-600 dark:text-slate-300">BizCopilot</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/login" className="hover:text-slate-700 dark:hover:text-slate-200">Sign in</Link>
          <Link href="/signup" className="hover:text-slate-700 dark:hover:text-slate-200">Sign up</Link>
          <span className="flex items-center gap-1.5 text-xs">
            <BrainCircuit className="h-3.5 w-3.5" /> AI-assisted, data-grounded
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <rect x="2" y="2" width="28" height="28" rx="8" className="fill-brand-600" />
      <path d="M9 21.5V13.8c0-1 .7-1.8 1.7-1.8h3.1c1 0 1.7.8 1.7 1.8v1.4c0 .9.7 1.6 1.6 1.6h.9c1 0 1.7.8 1.7 1.7v2.9c0 1-.8 1.8-1.7 1.8H10.7c-1 0-1.7-.8-1.7-1.7Z" className="fill-white" />
      <path d="M11 20.5h9" className="stroke-brand-600" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="23.5" cy="9.5" r="2.4" className="fill-accent-400" />
    </svg>
  );
}
