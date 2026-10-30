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
    primary: "bg-brand-500 text-white hover:bg-brand-600 shadow-[0_8px_18px_-8px_rgba(244,86,15,0.7)]",
    secondary: "bg-slate-900 text-white hover:bg-slate-700",
    ghost: "text-slate-600 hover:bg-white hover:text-slate-900",
    danger: "bg-red-600 text-white hover:bg-red-700",
    outline: "bg-white text-slate-800 shadow-sm hover:bg-slate-50",
  }[variant];
  const s = { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-13 px-8 text-base" }[size];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
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
    <div className={cn("rounded-3xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-18px_rgba(0,0,0,0.18)]", !pad && "overflow-hidden", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-7 pb-1 pt-6">
          <div>
            {title && <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>}
            {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? ((title || action) ? "px-7 pb-7 pt-4" : "p-7") : ""}>{children}</div>
    </div>
  );
}

/* -------------------------------- Badge ------------------------------- */

export function Badge({ tone = "neutral", children, className }: { tone?: "success" | "warning" | "error" | "info" | "neutral" | "accent"; children: ReactNode; className?: string }) {
  const t = {
    success: "bg-white text-emerald-600 ring-emerald-200",
    warning: "bg-white text-amber-600 ring-amber-200",
    error: "bg-white text-red-600 ring-red-200",
    info: "bg-brand-50 text-brand-600 ring-brand-200",
    neutral: "bg-slate-100 text-slate-600 ring-slate-200",
    accent: "bg-navy-900 text-white ring-navy-900",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", t, className)}>{children}</span>;
}

/* ------------------------------- Inputs ------------------------------- */

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
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
        "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[15px] text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
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
        "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
        className
      )}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("bc-scale-in relative w-full rounded-3xl bg-white p-6 shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-500 shadow-sm">{icon}</div>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{desc}</p>
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
          <div key={t.id} className="bc-fade-up pointer-events-auto flex items-start gap-3 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/5">
            {t.tone === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            {t.tone === "error" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
            {t.tone === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              {t.desc && <p className="mt-0.5 text-xs text-slate-500">{t.desc}</p>}
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
      <strong key={i} className="font-semibold text-slate-900">
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
    <div className="space-y-2 text-[15px] leading-7 text-slate-600">
      {lines.map((ln, i) => {
        if (!ln.trim()) return <div key={i} className="h-1" />;
        const isBullet = ln.trim().startsWith("- ");
        const body = isBullet ? ln.trim().slice(2) : ln;
        return (
          <p key={i} className={isBullet ? "flex gap-2 pl-1" : ""}>
            {isBullet && <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
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
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
        {desc && <p className="mt-2 max-w-2xl text-base text-slate-500">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
