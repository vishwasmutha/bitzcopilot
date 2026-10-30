import { NextResponse } from "next/server";
import { getModel, getProvider, pingLLM, rateLimited } from "@/lib/llm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ provider: getProvider(), model: getModel() });
}

/** "Test connection": makes one tiny real call and says plainly what is wrong if it fails. */
export async function POST() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 6)) return NextResponse.json({ error: "Wait a moment before testing again." }, { status: 429 });
  return NextResponse.json(await pingLLM());
}
