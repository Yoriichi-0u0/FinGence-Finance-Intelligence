import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/server/workspace/session";
import { workspaceEnabled } from "@/lib/server/workspace/store";
import { TeamConsole } from "@/components/workspace/team";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team" };

/** Hosted workspace only (404 unless FINGENCE_WORKSPACE=1 and the store is configured), and only for an Admin or Superadmin. */
export default async function Page() {
  if (!workspaceEnabled()) notFound();
  const who = await requireRole(await headers(), "ADMIN");
  if ("refusal" in who && who.refusal.status === 401) redirect("/sign-in");
  if ("refusal" in who && who.refusal.status === 403) notFound();
  return <TeamConsole />;
}
