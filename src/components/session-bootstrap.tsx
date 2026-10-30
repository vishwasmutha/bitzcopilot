"use client";

import { useEffect, useState } from "react";
import { authFetch, clearToken, readToken } from "@/lib/client-auth";
import { WhatsAppApp } from "./whatsapp-app";

/** Recovers a login when the httpOnly cookie was dropped. Never dead-ends on "Not authenticated". */
export function SessionBootstrap() {
  const [mode, setMode] = useState<"checking" | "wa" | "login">("checking");

  useEffect(() => {
    const token = readToken();
    if (!token) {
      window.location.replace("/login?error=session");
      return;
    }
    authFetch("/api/auth/adopt", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) {
          clearToken();
          window.location.replace("/login?error=session");
          return;
        }
        const tried = sessionStorage.getItem("bc_adopt_reload");
        if (!tried) {
          sessionStorage.setItem("bc_adopt_reload", "1");
          window.location.reload();
          return;
        }
        setMode("wa");
      })
      .catch(() => setMode("login"));
  }, []);

  if (mode === "wa") return <WhatsAppApp />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b141a] text-sm text-white/70">
      Signing you in…
    </div>
  );
}
