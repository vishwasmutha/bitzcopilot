"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Database, Mail, Megaphone, MessageCircle, Pencil, RefreshCw, Save, Trash2, FileText, PartyPopper, HeartHandshake, RotateCcw } from "lucide-react";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from "@/components/ui";

type Campaign = { id: string; type: string; title: string; content: string; engine: string; createdAt: Date | string; inputs: Record<string, unknown> | null };

const TYPES = [
  { key: "instagram", label: "Instagram caption", icon: Megaphone },
  { key: "whatsapp", label: "WhatsApp message", icon: MessageCircle },
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
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; content: string; engine: string; dataNote: string } | null>(null);
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
    loadCampaigns();
    fetch("/api/inventory")
      .then((r) => r.json())
      .then((j) => setProducts((j.products ?? []).map((p: { name: string }) => p.name)))
      .catch(() => {});
  }, [loadCampaigns]);

  const generate = async (regen = false) => {
    setBusy(true);
    setEditing(false);
    try {
      const r = await fetch("/api/marketing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          discount: form.discount ? Number(form.discount) : null,
          festival: form.festival || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        push({ title: "Generation failed", desc: j.error, tone: "error" });
        return;
      }
      setResult(j);
      setDraft(j.content);
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
      body: JSON.stringify({ id, title: result.title, content: draft, type: form.type, engine: result.engine, inputs: form }),
    });
    if (r.ok) {
      push({ title: id ? "Campaign updated" : "Campaign saved", tone: "success" });
      setEditing(false);
      loadCampaigns();
    } else push({ title: "Save failed", tone: "error" });
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
        <Card title="Campaign brief" sub="Tell the assistant what you need" className="xl:col-span-2 h-fit">
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700 dark:text-slate-300">Content type</span>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setForm({ ...form, type: t.key })}
                    className={
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] font-medium transition-all " +
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
              <Field label="Discount % (optional)">
                <Input type="number" min={1} max={90} placeholder="e.g. 15" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
              </Field>
            </div>
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
        <div className="space-y-4 xl:col-span-3">
          <Card title="Generated content" sub="Review, edit and copy — publishing is always a manual step">
            {busy ? (
              <Spinner label="Writing your campaign from your sales trends…" />
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
                {editing ? (
                  <div>
                    <Textarea rows={7} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-[13px]" />
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
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-[13.5px] leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">{result.content}</pre>
                )}
                {!editing && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(draft)}>
                      {copied === "result" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(true); setDraft(result.content); }}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" onClick={() => save()}>
                      <Save className="h-3.5 w-3.5" /> Save campaign
                    </Button>
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
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{c.type}</Badge>
                      <p className="flex-1 truncate text-sm font-medium">{c.title}</p>
                      <span className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</span>
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
