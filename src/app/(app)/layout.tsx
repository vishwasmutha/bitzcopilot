import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/shell";
import { SessionBootstrap } from "@/components/session-bootstrap";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) return <SessionBootstrap />;
  if (!session.business) redirect("/onboarding");
  return (
    <AppShell
      businessName={session.business.name}
      category={session.business.category}
      userName={session.user.name}
      isDemo={session.business.isDemo}
    >
      {children}
    </AppShell>
  );
}
