"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeIndianRupee,
  Bell,
  DoorOpen,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  LineChart,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquareText,
  Package,
  Settings,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Badge, ToastProvider, useToast } from "./ui";
import { Logo } from "@/app/page";
import { clearToken } from "@/lib/client-auth";

type NavItem = { href: string; label: string; icon: typeof Bell };

/** Top pills */
const TOP: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/impact", label: "Impact", icon: BadgeIndianRupee },
  { href: "/assistant", label: "Assistant", icon: MessageSquareText },
  { href: "/cash", label: "Cash", icon: Wallet },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
];

/** Icon rail on the left */
const RAIL: NavItem[] = [
  { href: "/wa", label: "WhatsApp", icon: MessageCircle },
  { href: "/forecast", label: "Forecast", icon: LineChart },
  { href: "/what-if", label: "What if?", icon: FlaskConical },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/data", label: "Data & Import", icon: Upload },
  { href: "/autopilot", label: "Autopilot", icon: Gauge },
  { href: "/notifications", label: "Alerts", icon: Bell },
];

const ALL = [...TOP, ...RAIL, { href: "/settings", label: "Settings", icon: Settings }];

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
    <Link href="/notifications" className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#ececec] text-slate-700 transition-colors hover:bg-white" aria-label="Notifications">
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-xs font-bold text-white">{unread > 9 ? "9+" : unread}</span>
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tip, setTip] = useState<{ label: string; icon: NavItem["icon"]; active: boolean; top: number; left: number } | null>(null);
  const [tipShown, setTipShown] = useState(false);
  const [tipSlides, setTipSlides] = useState(false);
  const tipShownRef = useRef(false);
  const tipScrollY = useRef(0);

  /** One floating label for the whole rail, so it sits above the page and slides from icon to icon. */
  const showTip = (el: HTMLElement, n: NavItem, active: boolean) => {
    const r = el.getBoundingClientRect();
    tipScrollY.current = window.scrollY;
    const next = { label: n.label, icon: n.icon, active, top: r.top, left: r.left };
    if (tipShownRef.current) {
      setTip(next);
      return;
    }
    setTipSlides(false);
    setTip(next);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        tipShownRef.current = true;
        setTipSlides(true);
        setTipShown(true);
      })
    );
  };
  const hideTip = () => {
    tipShownRef.current = false;
    setTipShown(false);
  };
  useEffect(() => {
    const onScroll = () => {
      if (Math.abs(window.scrollY - tipScrollY.current) > 4) hideTip();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const focusWa = pathname === "/wa";

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clearToken();
    router.push("/login");
    router.refresh();
    toast({ title: "Signed out", desc: "See you next time.", tone: "info" });
  };

  if (focusWa) {
    return (
      <ToastProvider>
        <div className="min-h-screen bg-[#0b141a]">{children}</div>
      </ToastProvider>
    );
  }

  const pill = (n: NavItem) => {
    const active = pathname === n.href;
    return (
      <Link
        key={n.href}
        href={n.href}
        title={n.label}
        aria-current={active ? "page" : undefined}
        className={"flex h-11 items-center gap-2 rounded-full pl-1 transition-colors " + (active ? "bg-white pr-4 shadow-sm" : "bg-[#ececec] pr-1 hover:bg-white xl:pr-4")}
      >
        <span className={"flex h-9 w-9 items-center justify-center rounded-full " + (active ? "bg-slate-900 text-white" : "bg-white text-slate-700")}>
          <n.icon className="h-[17px] w-[17px]" />
        </span>
        <span className={"text-sm font-medium text-slate-800 " + (active ? "" : "hidden xl:inline")}>{n.label}</span>
      </Link>
    );
  };

  /** Icon circle; its label is the floating pill rendered once at the end of the shell. */
  const railItem = (n: NavItem, opts: { href?: string; onClick?: () => void; active?: boolean }) => {
    const { href, onClick, active } = opts;
    const circle = "flex h-11 w-11 items-center justify-center rounded-full transition-colors " + (active ? "bg-slate-900 text-white" : "bg-white text-slate-600");
    return (
      <div
        key={n.label}
        className="h-11 w-11"
        onMouseEnter={(e) => showTip(e.currentTarget, n, !!active)}
        onFocus={(e) => showTip(e.currentTarget, n, !!active)}
        onBlur={hideTip}
      >
        {href ? (
          <Link href={href} aria-label={n.label} aria-current={active ? "page" : undefined} className={circle}>
            <n.icon className="h-[18px] w-[18px]" />
          </Link>
        ) : (
          <button type="button" onClick={onClick} aria-label={n.label} className={circle}>
            <n.icon className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>
    );
  };

  const railBtn = (n: NavItem) => railItem(n, { href: n.href, active: pathname === n.href });

  const wordmark = (
    <Link href="/dashboard" className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white p-2.5">
        <Logo className="h-full w-full" />
      </span>
      <span className="hidden min-w-0 sm:block">
        <span className="block truncate text-lg font-semibold leading-tight tracking-tight text-slate-900">
          Biz<span className="text-brand-500">Copilot</span>
        </span>
        <span className="block max-w-[140px] truncate text-xs text-slate-400">{businessName}</span>
      </span>
    </Link>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen p-2 sm:p-6">
        <div className="mx-auto max-w-[1520px] rounded-[2rem] bg-[#f5f5f5] p-3 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.35)] sm:p-6">
          {/* Top bar */}
          <header className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ececec] text-slate-700 lg:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            {wordmark}
            <nav aria-label="Main" className="mx-auto hidden items-center gap-2 lg:flex">
              {TOP.map(pill)}
            </nav>
            <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
              {isDemo && <Badge tone="warning" className="max-sm:hidden">Demo data</Badge>}
              <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ececec] text-slate-700 transition-colors hover:bg-white" aria-label="Exit to home without signing out" title="Exit to home without signing out">
                <DoorOpen className="h-[18px] w-[18px]" />
              </Link>
              <BellWidget />
              <div className="flex h-11 items-center gap-2 rounded-full bg-[#ececec] pl-1 pr-4" title={category}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{userName.slice(0, 1).toUpperCase()}</span>
                <span className="hidden max-w-[110px] truncate text-sm font-medium text-slate-800 sm:block">{userName}</span>
              </div>
            </div>
          </header>

          <div className="mt-6 flex gap-5">
            {/* Icon rail */}
            <aside className="hidden shrink-0 lg:block" onMouseLeave={hideTip}>
              <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col items-center gap-3">
                <div className="flex flex-col items-center gap-2 rounded-full bg-[#ececec] p-1.5">{RAIL.map(railBtn)}</div>
                <div className="flex flex-col items-center gap-2 rounded-full bg-[#ececec] p-1.5">
                  {railBtn({ href: "/settings", label: "Settings", icon: Settings })}
                  {railItem({ href: "#", label: "Log out", icon: LogOut }, { onClick: signOut })}
                </div>
              </div>
            </aside>

            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </div>
      </div>

      {/* Rail label: one pill that slides between icons */}
      {tip && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80] hidden h-11 items-center gap-2 whitespace-nowrap rounded-full bg-white pl-1 pr-4 text-sm font-medium text-slate-800 shadow-lg lg:flex"
          style={{
            top: tip.top,
            left: tip.left,
            opacity: tipShown ? 1 : 0,
            transition: tipSlides ? "top 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease" : "opacity 160ms ease",
          }}
        >
          <span className={"flex h-9 w-9 items-center justify-center rounded-full " + (tip.active ? "bg-slate-900 text-white" : "bg-[#ececec] text-slate-700")}>
            <tip.icon className="h-[17px] w-[17px]" />
          </span>
          {tip.label}
        </div>
      )}

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-2 left-2 flex w-[280px] flex-col gap-4 overflow-y-auto rounded-3xl bg-[#f5f5f5] p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              {wordmark}
              <button onClick={() => setMobileOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-600" aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {ALL.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMobileOpen(false)}
                    className={"flex h-11 items-center gap-3 rounded-full px-2 text-sm font-medium " + (active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70")}
                  >
                    <span className={"flex h-8 w-8 items-center justify-center rounded-full " + (active ? "bg-slate-900 text-white" : "bg-white text-slate-600")}>
                      <n.icon className="h-4 w-4" />
                    </span>
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <button onClick={signOut} className="mt-auto flex h-11 items-center gap-3 rounded-full px-2 text-sm font-medium text-slate-600 hover:bg-white/70">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white"><LogOut className="h-4 w-4" /></span>
              Log out
            </button>
          </aside>
        </div>
      )}
    </ToastProvider>
  );
}
