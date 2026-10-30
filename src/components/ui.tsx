"use client";

import { createContext, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------- Button ------------------------------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20",
    secondary: "bg-navy-900 text-white hover:bg-navy-800 dark:bg-slate-100 dark:text-navy-950 dark:hover:bg-white",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
    danger: "bg-red-600 text-white hover:bg-red-700",
    outline: "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800",
  }[variant];
  const s = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" }[size];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
        v,
        s,
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/* -------------------------------- Card -------------------------------- */

export function Card({
  title,
  sub,
  action,
  className,
  children,
  pad = true,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] dark:border-slate-800 dark:bg-slate-900", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            {title && <h3 className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>}
            {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </div>
  );
}

/* -------------------------------- Badge ------------------------------- */

export function Badge({ tone = "neutral", children, className }: { tone?: "success" | "warning" | "error" | "info" | "neutral" | "accent"; children: ReactNode; className?: string }) {
  const t = {
    success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
    warning: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
    error: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
    info: "bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300",
    neutral: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300",
    accent: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", t, className)}>{children}</span>;
}

/* ------------------------------- Inputs ------------------------------- */

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        className
      )}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("bc-scale-in relative w-full rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------- Spinner/Empty --------------------------- */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">{icon}</div>
      <h3 className="font-display text-[15px] font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{desc}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ------------------------------ Toasts -------------------------------- */

type ToastItem = { id: number; title: string; desc?: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<{ push: (t: Omit<ToastItem, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="bc-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {t.tone === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            {t.tone === "error" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
            {t.tone === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t.title}</p>
              {t.desc && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.desc}</p>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* --------------------------- Markdown (lite) --------------------------- */

function renderInline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-slate-900 dark:text-white">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[13.5px] leading-relaxed text-slate-600 dark:text-slate-300">
      {lines.map((ln, i) => {
        if (!ln.trim()) return <div key={i} className="h-1" />;
        const isBullet = ln.trim().startsWith("- ");
        const body = isBullet ? ln.trim().slice(2) : ln;
        return (
          <p key={i} className={isBullet ? "flex gap-2 pl-1" : ""}>
            {isBullet && <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />}
            <span>{renderInline(body)}</span>
          </p>
        );
      })}
    </div>
  );
}

/* ----------------------------- Page header ----------------------------- */

export function PageHeader({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
