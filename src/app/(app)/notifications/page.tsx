"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CheckCheck, Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, useToast } from "@/components/ui";

type Notif = { id: string; type: string; severity: string; title: string; message: string; read: boolean; createdAt: Date | string; impactRs?: number | null };

const SEV_ICON: Record<string, { icon: typeof Info; cls: string }> = {
  critical: { icon: BellOff, cls: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400" },
  warning: { icon: ShieldAlert, cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400" },
  positive: { icon: TrendingUp, cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" },
  info: { icon: Info, cls: "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400" },
};

const SEV_TONE: Record<string, "error" | "warning" | "success" | "info"> = {
  critical: "error",
  warning: "warning",
  positive: "success",
  info: "info",
};

export default function NotificationsPage() {
  const { push } = useToast();
  const [notifs, setNotifs] = useState<Notif[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((j) => setNotifs(j.notifications ?? []))
      .catch(() => setNotifs([]));
  }, []);
  useEffect(load, [load]);

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, { method: "PUT" });
    setNotifs((ns) => (ns ? ns.map((n) => (n.id === id ? { ...n, read: true } : n)) : ns));
  };

  const markAll = async () => {
    setBusyAll(true);
    try {
      await fetch("/api/notifications", { method: "POST" });
      setNotifs((ns) => (ns ? ns.map((n) => ({ ...n, read: true })) : ns));
      push({ title: "All notifications marked as read", tone: "info" });
    } finally {
      setBusyAll(false);
    }
  };

  const list = notifs?.filter((n) => (filter === "all" ? true : !n.read)) ?? [];

  return (
    <div className="bc-fade-up max-w-4xl">
      <PageHeader
        title="Business Alerts"
        desc="Rule-based alerts generated from your live data: sales drops, stockouts, demand surges and engagement signals."
        actions={
          <Button variant="outline" onClick={markAll} loading={busyAll}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900 w-fit">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "rounded-md px-4 py-1.5 text-sm font-medium capitalize " +
              (filter === f ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")
            }
          >
            {f} {f === "unread" && notifs ? `(${notifs.filter((n) => !n.read).length})` : ""}
          </button>
        ))}
      </div>

      <Card pad={false}>
        {notifs === null ? (
          <Spinner />
        ) : list.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<Bell className="h-5 w-5" />} title={filter === "unread" ? "You're all caught up" : "No alerts yet"} desc="Alerts appear here automatically as the system watches your sales, stock and customers." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((n) => {
              const s = SEV_ICON[n.severity] ?? SEV_ICON.info;
              const Icon = s.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => !n.read && markRead(n.id)}
                  className={
                    "flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40 " +
                    (n.read ? "opacity-70" : "bg-white dark:bg-slate-900")
                  }
                >
                  <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + s.cls}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={"text-sm " + (n.read ? "font-medium text-slate-600 dark:text-slate-300" : "font-semibold text-slate-900 dark:text-white")}>{n.title}</p>
                      <Badge tone={SEV_TONE[n.severity] ?? "info"}>{n.severity}</Badge>
                      {n.impactRs ? <Badge tone="warning">₹{Math.round(n.impactRs).toLocaleString("en-IN")} at stake</Badge> : null}
                      {!n.read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{n.message}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(n.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
