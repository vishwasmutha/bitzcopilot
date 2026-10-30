import { NextResponse } from "next/server";
import { db } from "@/db";
import { marketingCampaigns, waMessages } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { saveApprovedPromo } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const content = String(body?.content ?? "").trim();
    const title = String(body?.title ?? "WhatsApp promo").trim();
    const messageId = body?.messageId ? String(body.messageId) : null;
    const lang = String(body?.lang ?? "kn");
    if (content.length < 4) return NextResponse.json({ error: "Nothing to approve." }, { status: 400 });

    const campaign = await saveApprovedPromo(session.business.id, {
      title,
      content,
      product: body?.product ? String(body.product) : undefined,
      lang,
    });

    if (messageId) {
      const rows = await db
        .select()
        .from(waMessages)
        .where(and(eq(waMessages.id, messageId), eq(waMessages.businessId, session.business.id)))
        .limit(1);
      if (rows[0]) {
        const meta = rows[0].metaJson ? JSON.parse(rows[0].metaJson) : {};
        if (meta.promo) meta.promo.status = "approved";
        meta.campaignId = campaign.id;
        await db.update(waMessages).set({ metaJson: JSON.stringify(meta) }).where(eq(waMessages.id, messageId));
      }
    }

    const note =
      lang === "hi"
        ? "मंज़ूर हो गया। ग्राहकों को तब तक कुछ नहीं जाएगा जब तक आप Send नहीं दबाते।"
        : lang === "kn"
          ? "ಅನುಮೋದಿಸಲಾಗಿದೆ. ನೀವು Send ಒತ್ತುವವರೆಗೆ ಗ್ರಾಹಕರಿಗೆ ಏನೂ ಹೋಗುವುದಿಲ್ಲ."
          : "Approved. Nothing reaches customers until you tap Send.";
    const [msg] = await db
      .insert(waMessages)
      .values({
        businessId: session.business.id,
        direction: "out",
        kind: "system",
        body: note,
        lang,
        metaJson: JSON.stringify({ campaignId: campaign.id, status: "approved" }),
      })
      .returning();
    return NextResponse.json({ ok: true, campaign, message: { ...msg, meta: msg.metaJson ? JSON.parse(msg.metaJson) : null } });
  } catch (e) {
    console.error("approve failed", e);
    return NextResponse.json({ error: "Could not approve that promo." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = String(body?.campaignId ?? "");
  const lang = String(body?.lang ?? "kn");
  if (!id) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const rows = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessId, session.business.id)))
    .limit(1);
  if (!rows[0]) return NextResponse.json({ error: "Promo not found." }, { status: 404 });
  if (rows[0].status !== "approved" && rows[0].status !== "sent") {
    return NextResponse.json({ error: "Approve the promo before sending." }, { status: 400 });
  }
  await db.update(marketingCampaigns).set({ status: "sent" }).where(eq(marketingCampaigns.id, id));
  const note =
    lang === "hi"
      ? "आपने Send दबाया। यह आपके व्हाट्सऐप से जाएगा — BizCopilot खुद ग्राहकों को मैसेज नहीं करता।"
      : lang === "kn"
        ? "ನೀವು Send ಒತ್ತಿದ್ದೀರಿ. ಇದು ನಿಮ್ಮ ವಾಟ್ಸಾಪ್‌ನಿಂದ ಹೋಗುತ್ತದೆ — BizCopilot ತಾನೇ ಗ್ರಾಹಕರಿಗೆ ಮೆಸೇಜ್ ಮಾಡುವುದಿಲ್ಲ."
        : "You tapped Send. It goes out from your WhatsApp — BizCopilot never messages customers on its own.";
  const [msg] = await db
    .insert(waMessages)
    .values({ businessId: session.business.id, direction: "out", kind: "system", body: note, lang, metaJson: JSON.stringify({ campaignId: id, status: "sent" }) })
    .returning();
  return NextResponse.json({ ok: true, message: { ...msg, meta: { campaignId: id, status: "sent" } } });
}
