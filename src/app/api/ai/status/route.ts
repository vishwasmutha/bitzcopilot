import { NextResponse } from "next/server";
import { getProvider } from "@/lib/llm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ provider: getProvider() });
}
