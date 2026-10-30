"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Database, FlaskConical, LineChart, Mail, ShieldCheck, Smartphone, Users, Megaphone, MessageCircle, Pencil, RefreshCw, Save, Trash2, FileText, PartyPopper, HeartHandshake, RotateCcw } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from "@/components/ui";

type Campaign = { id: string; type: string; title: string; content: string; engine: string; createdAt: Date | string; inputs: Record<string, unknown> | null; status?: string; approvedAt?: string | null };
type Guardrail = { requested: number | null; applied: number | null; cap: number; clamped: boolean; breakEvenUnitsPct: number | null; note: string };

const TYPES = [
  { key: "instagram", label: "Instagram caption", icon: Megaphone },
  { key: "whatsapp", label: "WhatsApp message", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: Smartphone },
  { key: "email", label: "Email campaign", icon: Mail },
  { key: "discount", label: "Discount offer", icon: TagIcon },
  { key: "description", label: "Product description", icon: FileText },
  { key: "festival", label: "Festival promotion", icon: PartyPopper },
  { key: "retention", label: "Win-back campaign", icon: HeartHandshake },
];

function TagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 2H2v10l9.3 9.3a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8L12 2Z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}

const SEGMENTS = ["All customers", "Loyal customers", "At-risk customers", "Inactive customers", "New customers", "Local neighbourhood"];
const OBJECTIVES = ["Grow revenue", "Drive footfall", "Clear slow inventory", "Win back customers", "Launch a new product", "Boost weekend traffic"];
const TONES = ["friendly", "professional", "playful", "urgent"];
const LANGS = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" },
  { id: "kn", label: "ಕನ್ನಡ" },
];
/** One-to-one channels need customers who agreed to be messaged. */
const DIRECT = ["whatsapp", "sms", "email", "retention", "discount"];

type Audience = { total: number; consented: number; withPhone: number; rule: string };
type Tracked = { experimentId: string; treatment: { refId: string; name: string | null; phone: string | null }[]; heldBack: number; excludedNoConsent: number; excludedNoPhone: number };

export default function MarketingPage() {
  const { push } = useToast();
  const [products, setProducts] = useState<string[]>([]);
  const [form, setForm] = useState({
    type: "instagram",
    product: "auto",
    segment: "All customers",
    objective: "Grow revenue",
    tone: "friendly",
    discount: "",
    festival: "",
    lang: "en",
  });
  const [spec, setSpec] = useState<Record<string, number> | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; content: string; engine: string; dataNote: string; product?: string; guardrail?: Guardrail | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadCampaigns = useCallback(() => {
    fetch("/api/marketing/campaigns")
      .then((r) => r.json())
      .then((j) => setCampaigns(j.campaigns ?? []))
      .catch(() => setCampaigns([]));
  }, []);

  useEffect(() => {
    // Links from the Impact page pre-fill the brief (?type=&product=&discount=&segment=).
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams(window.location.search);
      const type = q.get("type");
      const product = q.get("product");
      const discount = q.get("discount");
      const segment = q.get("segment");
      const rawSpec = q.get("spec");
      if (rawSpec) {
        try {
          setSpec(JSON.parse(rawSpec));
        } catch {
          setSpec(null);
        }
      }
      if (type || product || discount || segment) {
        setForm((f) => ({
          ...f,
          type: type && TYPES.some((t) => t.key === type) ? type : f.type,
          product: product ?? f.product,
          discount: discount && Number(discount) > 0 ? String(Math.min(90, Math.round(Number(discount)))) : f.discount,
          segment: segment && (SEGMENTS.includes(segment) || (segment === "Custom segment" && rawSpec)) ? segment : f.segment,
        }));
      }
    }, 0);
    loadCampaigns();
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((j) => setProducts((j.products ?? []).map((p: { name: string }) => p.name)))
      .catch(() => {});
    return () => window.clearTimeout(timer);
  }, [loadCampaigns]);

  useEffect(() => {
    const specParam = form.segment === "Custom segment" ? `&spec=${encodeURIComponent(JSON.stringify(spec ?? {}))}` : "";
    let live = true;
    const request = form.segment === "Local neighbourhood" ? Promise.resolve(null) : fetch(`/api/audience?segment=${encodeURIComponent(form.segment)}${specParam}`).then((r) => r.json());
    request
      .then((j) => live && setAudience(j && j.ok && j.targetable ? j : null))
      .catch(() => live && setAudience(null));
    return () => {
      live = false;
    };
  }, [form.segment, spec]);

  const generate = async (regen = false) => {
    setBusy(true);
    setEditing(false);
    setBlocked(null);
    setTracked(null);
    try {
      const r = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          spec: form.segment === "Custom segment" ? spec ?? {} : undefined,
          discount: form.discount ? Number(form.discount) : null,
          festival: form.festival || undefined,
        }),
      });
      const j = await r.json();
      if (r.status === 409 && j.blocked) {
        setResult(null);
        setBlocked(j.error);
        return;
      }
      if (!r.ok) {
        push({ title: "Generation failed", desc: j.error, tone: "error" });
        return;
      }
      setResult(j);
      setDraft(j.content);
      if (j.guardrail?.clamped) setForm((f) => ({ ...f, discount: String(j.guardrail.applied) }));
      push({ title: regen ? "Regenerated" : "Content ready", desc: `Engine: ${j.engine}`, tone: "success" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id ?? "result");
      setTimeout(() => setCopied(null), 1500);
      push({ title: "Copied to clipboard", tone: "success" });
    } catch {
      push({ title: "Copy failed", desc: "Select the text manually.", tone: "error" });
    }
  };

  const save = async (id?: string) => {
    if (!result) return;
    const r = await fetch("/api/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title: result.title, content: draft, type: form.type, engine: result.engine, inputs: { ...form, product: result.product ?? form.product, discount: result.guardrail?.applied ?? (form.discount ? Number(form.discount) : null) } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      push({ title: id ? "Campaign updated" : "Campaign saved", tone: "success" });
      setEditing(false);
      loadCampaigns();
      return j.campaign as { id: string } | undefined;
    }
    push({ title: "Save failed", tone: "error" });
    return undefined;
  };

  /** Save the draft, split the consenting segment into messaged and held back, and show who to message. */
  const startTracked = async () => {
    if (!result) return;
    setStarting(true);
    try {
      const camp = await save();
      const r = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: camp?.id, title: result.title, segment: form.segment, spec: form.segment === "Custom segment" ? spec ?? {} : undefined, product: result.product, holdoutPct: 20 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return push({ title: "Could not start the test", desc: j.error, tone: "error" });
      setTracked(j);
      loadCampaigns();
    } finally {
      setStarting(false);
    }
  };

  const track = async (id: string) => {
    const r = await fetch("/api/impact/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: id }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      push({ title: "Tracking started", desc: "Check the Impact page in 3 days to see what it added.", tone: "success" });
      loadCampaigns();
    } else push({ title: "Could not start tracking", desc: j.error, tone: "error" });
  };

  const remove = async (id: string) => {
    await fetch(`/api/marketing/campaigns?id=${id}`, { method: "DELETE" });
    loadCampaigns();
    push({ title: "Campaign deleted", tone: "info" });
  };

  return (
    <div className="bc-fade-up">
      <PageHeader title="AI Marketing Studio" desc="Copy generated around your real trends — if a product is slipping, the assistant will point it at that product. Nothing is published without your approval." />
      <div className="grid gap-4 xl:grid-cols-5">
        {/* Form */}
        <Card title="Campaign brief" sub="Tell the assistant what you need" className="min-w-0 xl:col-span-2 h-fit">
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Content type</span>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setForm({ ...form, type: t.key })}
                    className={
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-all " +
                      (form.type === t.key
                        ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800")
                    }
                  >
                    <t.icon className="h-4 w-4 shrink-0" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Product focus" hint="“Auto” picks the best candidate from your sales trends.">
              <Select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
                <option value="auto">Auto (data-driven)</option>
                {products.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target segment">
                <Select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                  {SEGMENTS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                  {spec && <option>Custom segment</option>}
                </Select>
              </Field>
              <Field label="Objective">
                <Select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })}>
                  {OBJECTIVES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tone">
                <Select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}>
                  {TONES.map((s) => (
                    <option key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Language">
                <Select id="mk-lang" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })}>
                  {LANGS.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Discount % (optional)">
                <Input type="number" min={1} max={90} placeholder="e.g. 15" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </Field>
            </div>
            {audience && (
              <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 text-xs " + (DIRECT.includes(form.type) && audience.consented === 0 ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300")}>
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {audience.total} customer{audience.total === 1 ? "" : "s"} in this segment, <strong>{audience.consented} agreed to be messaged</strong>.
                  {DIRECT.includes(form.type) ? " Only they are included in a message for sending." : " A public post does not need consent."}
                </span>
              </div>
            )}
            {form.type === "festival" && (
              <Field label="Occasion">
                <Input placeholder="e.g. Diwali, Christmas, Grand Reopening" value={form.festival} onChange={(e) => setForm({ ...form, festival: e.target.value })} />
              </Field>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={() => generate(false)} loading={busy} className="flex-1">
                <RotateCcw className="h-4 w-4" /> Generate
              </Button>
              {result && (
                <Button variant="outline" onClick={() => generate(true)} loading={busy} aria-label="Regenerate campaign content" title="Regenerate campaign content">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Result + saved */}
        <div className="min-w-0 space-y-4 xl:col-span-3">
          <Card title="Generated content" sub="Review, edit and copy — publishing is always a manual step">
            {busy ? (
              <Spinner label="Writing your campaign from your sales trends…" />
            ) : blocked ? (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>{blocked}</p>
                  <a href="/customers" className="mt-2 inline-block font-semibold underline">Open Customers to record consent</a>
                </div>
              </div>
            ) : !result ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-400">
                <Megaphone className="h-7 w-7" />
                Set your brief on the left and hit Generate.
              </div>
            ) : (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{result.engine}</Badge>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{result.title}</span>
                </div>
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2.5 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
                  <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {result.dataNote}
                </div>
                {result.guardrail && (
                  <div
                    className={
                      "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs " +
                      (result.guardrail.clamped
                        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300")
                    }
                  >
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <strong>Margin check.</strong> {result.guardrail.note}
                    </span>
                  </div>
                )}
                {editing ? (
                  <div>
                    <Textarea rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-sm" />
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => save()}>
                        <Save className="h-3.5 w-3.5" /> Save changes
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">{result.content}</pre>
                )}
                {!editing && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(draft)}>
                      {copied === "result" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(true); setDraft(result.content); }}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => save()}>
                      <Save className="h-3.5 w-3.5" /> Save campaign
                    </Button>
                    {audience && audience.consented >= 10 && DIRECT.includes(form.type) && !tracked && (
                      <Button size="sm" onClick={startTracked} loading={starting} disabled={starting}>
                        <FlaskConical className="h-3.5 w-3.5" /> Start tracked send
                      </Button>
                    )}
                  </div>
                )}
                {tracked && (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-500/25 dark:bg-emerald-500/10">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">Test started. Message these {tracked.treatment.length} customers.</p>
                    <p className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-300/90">
                      {tracked.heldBack} others were chosen at random to be held back. Please do not message them. That is what lets the Impact page say what this message really earned.
                      {tracked.excludedNoConsent > 0 ? ` ${tracked.excludedNoConsent} customers were left out because they have not agreed to be messaged.` : ""}
                      {tracked.excludedNoPhone > 0 ? ` ${tracked.excludedNoPhone} have no phone number saved.` : ""}
                    </p>
                    <ul className="mt-3 max-h-48 divide-y divide-emerald-200/70 overflow-auto rounded-md bg-white/70 text-xs dark:divide-emerald-500/20 dark:bg-slate-900/40">
                      {tracked.treatment.map((t) => (
                        <li key={t.refId} className="flex justify-between gap-3 px-3 py-1.5">
                          <span className="truncate">{t.name ?? t.refId}</span>
                          <span className="tabular-nums text-slate-500">{t.phone ?? "no number"}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => copy(tracked.treatment.map((t) => `${t.name ?? t.refId}\t${t.phone ?? ""}`).join("\n"), "tracked")}>
                        {copied === "tracked" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy the list
                      </Button>
                      <a href="/impact" className="inline-flex items-center text-xs font-semibold text-emerald-800 underline dark:text-emerald-300">Follow the result on Impact</a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card title="Saved campaigns" sub="Your library — copy anything at any time" pad={false}>
            {campaigns === null ? (
              <Spinner />
            ) : campaigns.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">Nothing saved yet. Generate a campaign and hit “Save campaign”.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.map((c) => (
                  <div key={c.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{c.type}</Badge>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</p>
                      {c.approvedAt ? (
                        <Badge tone="success">Tracking lift</Badge>
                      ) : c.inputs?.product && c.inputs.product !== "auto" ? (
                        <button onClick={() => track(c.id)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10" title="Starts measuring what this promo adds">
                          <LineChart className="h-3.5 w-3.5" /> I sent this
                        </button>
                      ) : null}
                      <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</span>
                      <button onClick={() => copy(c.content, c.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Copy campaign" aria-label={`Copy campaign ${c.title}`}>
                        {copied === c.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <button onClick={() => remove(c.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" title="Delete campaign" aria-label={`Delete campaign ${c.title}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 line-clamp-2 whitespace-pre-line text-xs text-slate-500 dark:text-slate-400">{c.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
