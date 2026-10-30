"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  FlaskConical,
  LineChart,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Moon,
  Package,
  Settings,
  Sun,
  Upload,
  Users,
  Menu,
  X,
} from "lucide-react";
import { Badge, ToastProvider, useToast } from "./ui";
import { Logo } from "@/app/page";
import { clearToken } from "@/lib/client-auth";

const NAV = [
  { href: "/dashboard", label: "Business dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/wa", label: "WhatsApp", icon: MessageCircle, group: "Overview" },
  { href: "/assistant", label: "AI Assistant", icon: MessageSquareText, group: "Overview" },
  { href: "/data", label: "Data & Import", icon: Upload, group: "Analyze" },
  { href: "/what-if", label: "What if?", icon: FlaskConical, group: "Analyze" },
  { href: "/forecast", label: "Forecast", icon: LineChart, group: "Analyze" },
  { href: "/customers", label: "Customers", icon: Users, group: "Analyze" },
  { href: "/inventory", label: "Inventory", icon: Package, group: "Operate" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, group: "Operate" },
  { href: "/notifications", label: "Alerts", icon: Bell, group: "Workspace" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Workspace" },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDark(document.documentElement.classList.contains("dark")), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("bc-theme", next ? "dark" : "light");
    setDark(next);
  };
  return { dark, toggle };
}

function BellWidget() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setUnread(j?.unread ?? 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 90_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <Link
      href="/notifications"
      className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
      aria-label="Notifications"
    >
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

export function AppShell({
  businessName,
  category,
  userName,
  isDemo,
  children,
}: {
  businessName: string;
  category: string;
  userName: string;
  isDemo: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { push: toast } = useToast();
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = NAV.find((n) => n.href === pathname)?.label ?? "WhatsApp";
  const focusWa = pathname === "/wa";

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clearToken();
    router.push("/login");
    router.refresh();
    toast({ title: "Signed out", desc: "See you next time.", tone: "info" });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className={"flex h-16 items-center gap-2.5 border-b border-white/10 px-4 " + (collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="font-display text-[15px] font-bold text-white">BizCopilot</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:block"
          aria-label="Toggle sidebar"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-white/10 px-4 py-3">
        <p className={"truncate text-sm font-semibold text-white " + (collapsed ? "lg:text-center lg:text-base" : "")}>
          {collapsed ? businessName.slice(0, 1) : businessName}
        </p>
        {!collapsed && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">{category}</span>
            {isDemo && <Badge tone="warning">Demo data</Badge>}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {["Overview", "Analyze", "Operate", "Workspace"].map((group) => (
          <div key={group}>
            {!collapsed && <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{group}</p>}
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === group).map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    title={n.label}
                    onClick={() => setMobileOpen(false)}
                    className={
                      "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors " +
                      (collapsed ? "lg:justify-center lg:px-0 " : "") +
                      (active
                        ? "bg-brand-600/20 text-white ring-1 ring-inset ring-brand-500/30"
                        : "text-slate-400 hover:bg-white/5 hover:text-white")
                    }
                  >
                    <n.icon className={"h-[17px] w-[17px] shrink-0 " + (active ? "text-brand-300" : "")} />
                    <span className={collapsed ? "lg:hidden" : ""}>{n.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className={"flex items-center gap-2.5 rounded-lg px-2 py-2 " + (collapsed ? "lg:justify-center" : "")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-xs font-bold text-white">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{userName}</p>
              <p className="text-[11px] text-slate-500">Business owner</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={signOut} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (focusWa) {
    return (
      <ToastProvider>
        <div className="min-h-screen bg-[#0b141a]">{children}</div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        {/* Desktop sidebar */}
        <aside
          className={
            "fixed inset-y-0 left-0 z-40 hidden bg-navy-950 transition-[width] duration-200 lg:block " +
            (collapsed ? "w-[70px]" : "w-[248px]")
          }
        >
          {sidebar}
        </aside>

        {/* Mobile sidebar */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-navy-950/60" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[270px] bg-navy-950">
              <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <div className={"lg:transition-[margin] " + (collapsed ? "lg:ml-[70px]" : "lg:ml-[248px]")}>
          {/* Topbar */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-slate-800 dark:bg-slate-950/85">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <h2 className="font-display text-[15px] font-semibold">{title}</h2>
              {isDemo && <Badge tone="warning">Demo data</Badge>}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggle}
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label="Toggle theme"
              >
                {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
              </button>
              <BellWidget />
              <div className="ml-1 hidden h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-accent-500 text-xs font-bold text-white sm:flex">
                {userName.slice(0, 1).toUpperCase()}
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
