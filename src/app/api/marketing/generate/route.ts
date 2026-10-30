import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { cleanSpec, consentSummary, resolveAudience, TARGETABLE } from "@/lib/audience";
import { generateMarketing, rateLimited } from "@/lib/llm";

export const runtime = "nodejs";

const TYPES = ["instagram", "whatsapp", "sms", "email", "discount", "description", "festival", "retention"];
/** One-to-one channels. A message for these is drafted only if someone in the segment agreed to be contacted. */
const DIRECT = ["whatsapp", "sms", "email", "retention", "discount"];

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 15)) return NextResponse.json({ error: "Generation limit reached — take a brief pause." }, { status: 429 });
  try {
    const body = await req.json().catch(() => null);
    const type = String(body?.type ?? "instagram");
    if (!TYPES.includes(type)) return NextResponse.json({ error: "Unknown content type." }, { status: 400 });
    const lang = ["en", "hi", "kn"].includes(body?.lang) ? body.lang : "en";
    const segment = String(body?.segment ?? "");

    // Consent gate
    let audience: { total: number; consented: number; withPhone: number } | null = null;
    if (DIRECT.includes(type) && (TARGETABLE as readonly string[]).includes(segment)) {
      const spec = segment === "Custom segment" ? cleanSpec(body?.spec) : undefined;
      const members = await resolveAudience(session.business.id, segment, spec);
      audience = consentSummary(members);
      if (audience.total > 0 && audience.consented === 0) {
        return NextResponse.json(
          {
            blocked: true,
            audience,
            error: `None of the ${audience.total} customers in “${segment}” have given marketing consent, so no ${type === "sms" ? "SMS" : type} was drafted for them. Record consent on the Customers page, or write a public post instead.`,
          },
          { status: 409 }
        );
      }
    }

    const result = await generateMarketing(session.business.id, session.business.name, session.business.category, {
      type,
      product: String(body?.product ?? "auto"),
      segment,
      objective: String(body?.objective ?? ""),
      tone: String(body?.tone ?? "friendly"),
      discount: body?.discount ? Math.min(90, Math.max(1, Number(body.discount) || 0)) : null,
      festival: body?.festival ? String(body.festival) : undefined,
      lang,
    });
    return NextResponse.json({ ok: true, ...result, audience });
  } catch (e) {
    console.error("marketing generate failed", e);
    return NextResponse.json({ error: "Content generation failed. Please try again." }, { status: 500 });
  }
}
