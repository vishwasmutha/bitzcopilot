import { clearSession } from "@/lib/auth";
import { clearSessionResponse } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await clearSession();
  return clearSessionResponse();
}
