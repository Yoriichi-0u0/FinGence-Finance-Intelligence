import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { m5LocalEnabled, m5RequestAllowed } from "@/lib/server/tenant-admin-m5/flags";
import AdministrationWorkspace from "@/components/tenant-admin-m5/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administration" };

export default async function AdministrationPage() {
  if (!m5LocalEnabled()) notFound();
  const incoming = await headers();
  let request: Request;
  try { request = new Request(`http://${incoming.get("host") ?? "invalid"}/admin`, { headers: incoming }); }
  catch { notFound(); }
  if (!m5RequestAllowed(request)) notFound();
  return <AdministrationWorkspace />;
}
