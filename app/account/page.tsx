import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/server/workspace/session";
import { workspaceEnabled } from "@/lib/server/workspace/store";
import { AccountPage } from "@/components/workspace/account";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account" };

/** Hosted workspace only (404 unless FINGENCE_WORKSPACE=1 and the store is configured); every signed-in member has an account page. */
export default async function Page() {
  if (!workspaceEnabled()) notFound();
  const who = await requireRole(await headers(), "FINANCE");
  if ("refusal" in who && who.refusal.status === 401) redirect("/sign-in");
  if ("refusal" in who) notFound();
  return <AccountPage />;
}
