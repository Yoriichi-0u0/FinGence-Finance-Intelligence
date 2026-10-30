import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { m5LocalEnabled, m5RequestAllowed } from "@/lib/server/tenant-admin-m5/flags";
import EnrollmentForm from "@/components/tenant-admin-m5/enroll";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create your account", referrer: "no-referrer" };

export default async function EnrollmentPage() {
  if (!m5LocalEnabled()) notFound();
  const incoming = await headers();
  let request: Request;
  try { request = new Request(`http://${incoming.get("host") ?? "invalid"}/enroll`, { headers: incoming }); }
  catch { notFound(); }
  if (!m5RequestAllowed(request)) notFound();
  return <EnrollmentForm />;
}
