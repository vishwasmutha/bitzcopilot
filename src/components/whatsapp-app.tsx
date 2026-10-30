"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Mic, Phone, Send, Square } from "lucide-react";
import { authFetch } from "@/lib/client-auth";
import { LANG_OPTIONS, type Lang } from "@/lib/utils";
import { MathReceipt, type ReceiptData } from "./receipt";

type Promo = { title: string; content: string; product?: string; status?: string; campaignId?: string };
type Msg = {
  id: string;
  direction: string;
  kind: string;
  body: string;
  lang: string;
  transcript: string | null;
  durationSec: number | null;
  createdAt: string;
  meta: { promo?: Promo; campaignId?: string; status?: string; date?: string; receipt?: ReceiptData } | null;
};

const CHIPS: Record<Lang, string[]> = {
  kn: ["ಎಣ್ಣೆ ₹5 ಹೆಚ್ಚಿಸಿದರೆ?", "ಸಪ್ಲೈಯರ್ ಒಂದು ವಾರ ತಡವಾದರೆ?", "ಅಕ್ಕಿ ಎಷ್ಟು ದಿನ ಸಾಕು?"],
  hi: ["अगर तेल ₹5 बढ़ा दूं?", "सप्लायर एक हफ्ता लेट हो तो?", "चावल कितने दिन चलेगा?"],
  en: ["What if I raise oil by ₹5?", "What if my supplier delays a week?", "How many days of rice are left?"],
};

const PLACE: Record<Lang, string> = {
  kn: "ಸಂದೇಶ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್…",
  hi: "मैसेज या वॉइस नोट…",
  en: "Message or voice note…",
};

function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function renderBody(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*[^*]+\*)/g);
    return (
      <p key={i} className={i ? "mt-1" : ""}>
        {parts.map((p, j) =>
          p.startsWith("*") && p.endsWith("*") ? (
            <strong key={j}>{p.slice(1, -1)}</strong>
          ) : (
            <span key={j}>{p}</span>
          )
        )}
      </p>
    );
  });
}

export function WhatsAppApp({ initialLang = "kn" }: { initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [shop, setShop] = useState<{ name: string; location: string | null; category: string; isDemo?: boolean } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsShop, setNeedsShop] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const started = useRef(0);

  const load = useCallback(async (nextLang: Lang) => {
    const r = await authFetch(`/api/wa/thread?lang=${nextLang}`);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      setError("Not authenticated");
      return;
    }
    if (j.needsOnboarding) {
      setNeedsShop(true);
      return;
    }
    setShop(j.business);
    setMsgs(j.messages ?? []);
    if (j.business?.language && !j.business.language) return;
  }, []);

  useEffect(() => {
    load(lang);
  }, [lang, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => {
    if (!listening) return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [listening]);

  const send = async (raw?: string, voice?: { durationSec: number }) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    setError(null);
    const optimistic: Msg = {
      id: "tmp-" + Date.now(),
      direction: "in",
      kind: voice ? "voice" : "text",
      body: q,
      lang,
      transcript: voice ? q : null,
      durationSec: voice?.durationSec ?? null,
      createdAt: new Date().toISOString(),
      meta: null,
    };
    setMsgs((m) => [...m, optimistic]);
    try {
      const r = await authFetch("/api/wa/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q, lang, voice }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Could not send.");
        return;
      }
      setMsgs((m) => [...m.filter((x) => x.id !== optimistic.id), { ...optimistic, id: optimistic.id + "ok" }, j.message]);
    } finally {
      setBusy(false);
    }
  };

  const startVoice = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!SR) {
      setError(lang === "kn" ? "ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ವಾಯ್ಸ್ ಇಲ್ಲ. ಕನ್ನಡದಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ." : lang === "hi" ? "इस ब्राउज़र में वॉइस नहीं है। हिंदी में टाइप करें।" : "Voice input needs Chrome. You can still type in Kannada or Hindi.");
      return;
    }
    const rec = new SR();
    rec.lang = LANG_OPTIONS.find((l) => l.id === lang)?.speech ?? "kn-IN";
    rec.interimResults = true;
    rec.continuous = false;
    started.current = Date.now();
    setSeconds(0);
    setListening(true);
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += piece;
        else interim += piece;
      }
      setText((finalText + " " + interim).trim());
    };
    rec.onerror = () => {
      setListening(false);
      setError(lang === "kn" ? "ವಾಯ್ಸ್ ಸಿಗಲಿಲ್ಲ. ಮತ್ತೆ ಮಾತನಾಡಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ." : "Couldn't hear that. Speak again or type.");
    };
    rec.onend = () => {
      setListening(false);
      const dur = Math.max(1, Math.round((Date.now() - started.current) / 1000));
      const said = (finalText || text).trim();
      if (said.length > 1) send(said, { durationSec: dur });
    };
    recRef.current = rec;
    rec.start();
  };

  const stopVoice = () => {
    recRef.current?.stop();
    setListening(false);
  };

  const approve = async (msg: Msg) => {
    const promo = msg.meta?.promo;
    if (!promo || promo.status === "approved" || promo.status === "sent") return;
    const r = await authFetch("/api/wa/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: msg.id, title: promo.title, content: promo.content, product: promo.product, lang }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error ?? "Approve failed");
      return;
    }
    setMsgs((list) =>
      list.map((m) => (m.id === msg.id ? { ...m, meta: { ...m.meta, promo: { ...promo, status: "approved" }, campaignId: j.campaign?.id } } : m)).concat(j.message)
    );
  };

  const sendPromo = async (campaignId: string) => {
    const r = await authFetch("/api/wa/approve", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId, lang }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.message) setMsgs((m) => [...m, j.message]);
    else setError(j.error ?? "Send failed");
  };

  const switchLang = async (next: Lang) => {
    setLang(next);
    if (shop) {
      await authFetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: shop.name, category: shop.category, language: next }),
      }).catch(() => {});
    }
  };

  if (needsShop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b141a] px-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Set up your shop first</p>
          <Link href="/onboarding" className="mt-4 inline-block rounded-full bg-[#25D366] px-5 py-2 text-sm font-semibold text-[#0b141a]">
            Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b141a] p-0 sm:p-6">
      <div className="flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-[#0b141a] sm:h-[min(860px,92dvh)] sm:rounded-[28px] sm:border sm:border-white/10 sm:shadow-2xl">
        <header className="flex items-center gap-3 bg-[#1f2c34] px-3 py-2.5 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366] text-lg font-bold text-[#0b141a]">
            {(shop?.name || "B").slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{shop?.name || "BizCopilot"}</p>
            <p className="truncate text-[11px] text-[#8eb8a8]">
              {shop?.location || "Bengaluru"} · 9:00 AM brief · {shop?.isDemo ? "demo shop" : "your shop"}
            </p>
          </div>
          <div className="flex rounded-full bg-black/30 p-0.5 text-[11px] font-semibold">
            {LANG_OPTIONS.map((l) => (
              <button
                key={l.id}
                onClick={() => switchLang(l.id)}
                className={"rounded-full px-2 py-1 " + (lang === l.id ? "bg-[#25D366] text-[#0b141a]" : "text-white/70")}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>

        <div
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "18px 18px", backgroundColor: "#0b141a" }}
        >
          <p className="mx-auto w-fit rounded-md bg-[#182229] px-2 py-1 text-[10px] text-white/50">Today · scheduled 9:00 AM IST</p>
          {msgs.map((m) => {
            const mine = m.direction === "in";
            const promo = m.meta?.promo;
            return (
              <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div className={"max-w-[88%] rounded-lg px-2.5 py-1.5 text-[13.5px] leading-snug shadow " + (mine ? "rounded-br-sm bg-[#005c4b] text-white" : m.kind === "system" ? "bg-[#182229] text-[#d1d7db]" : "rounded-bl-sm bg-[#1f2c34] text-[#e9edef]")}>
                  {m.kind === "brief" && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#25D366]">Daily brief</p>}
                  {m.kind === "voice" && (
                    <div className="mb-1 flex items-center gap-2">
                      <button
                        onClick={() => {
                          const u = window.speechSynthesis;
                          if (!u) return;
                          const utter = new SpeechSynthesisUtterance(m.transcript || m.body);
                          utter.lang = LANG_OPTIONS.find((l) => l.id === (m.lang as Lang))?.speech ?? "kn-IN";
                          u.speak(utter);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10"
                        aria-label="Play voice note"
                      >
                        <Phone className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex h-6 items-end gap-0.5">
                        {Array.from({ length: 16 }).map((_, i) => (
                          <span key={i} className="w-0.5 rounded-full bg-[#25D366]" style={{ height: 4 + ((i * 7) % 16) }} />
                        ))}
                      </div>
                      <span className="text-[11px] text-white/70">{m.durationSec || 1}s</span>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{renderBody(m.body)}</div>
                  {promo && (
                    <div className="mt-2 rounded-md bg-black/25 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-[#25D366]">Draft promo · not sent</p>
                      <p className="mt-1 text-[13px]">{promo.content}</p>
                      <div className="mt-2 flex gap-2">
                        {promo.status === "sent" ? (
                          <span className="text-[11px] text-white/60">Sent by you</span>
                        ) : promo.status === "approved" ? (
                          <button onClick={() => m.meta?.campaignId && sendPromo(m.meta.campaignId)} className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold">
                            Send
                          </button>
                        ) : (
                          <button onClick={() => approve(m)} className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-3 py-1 text-[12px] font-bold text-[#0b141a]">
                            <Check className="h-3.5 w-3.5" /> Approve
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {m.meta?.receipt && <MathReceipt receipt={m.meta.receipt} dark />}
                  <p className={"mt-1 text-right text-[10px] " + (mine ? "text-white/50" : "text-white/35")}>{istTime(m.createdAt)}</p>
                </div>
              </div>
            );
          })}
          {busy && <p className="text-[12px] text-white/40">…</p>}
          <div ref={bottom} />
        </div>

        <div className="bg-[#1f2c34] px-2 py-2">
          {error && <p className="mb-1 px-2 text-[11px] text-amber-300">{error}</p>}
          <div className="mb-2 flex gap-1.5 overflow-x-auto px-1">
            {CHIPS[lang].map((c) => (
              <button key={c} onClick={() => send(c)} className="shrink-0 rounded-full bg-[#0b141a] px-3 py-1 text-[11px] text-[#d1d7db]">
                {c}
              </button>
            ))}
            <Link href="/dashboard" className="shrink-0 rounded-full px-3 py-1 text-[11px] text-white/35 hover:text-white/70">
              Desk view
            </Link>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={listening ? stopVoice : startVoice}
              className={"flex h-11 w-11 shrink-0 items-center justify-center rounded-full " + (listening ? "bg-red-500 text-white" : "bg-[#0b141a] text-[#25D366]")}
              aria-label={listening ? "Stop voice note" : "Record voice note"}
            >
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={listening ? (lang === "kn" ? `ಕೇಳುತ್ತಿದ್ದೇನೆ… ${seconds}s` : lang === "hi" ? `सुन रहा हूँ… ${seconds}s` : `Listening… ${seconds}s`) : PLACE[lang]}
              className="max-h-24 min-h-[44px] flex-1 resize-none rounded-2xl bg-[#2a3942] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35"
            />
            <button onClick={() => send()} disabled={busy || !text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-[#0b141a] disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
