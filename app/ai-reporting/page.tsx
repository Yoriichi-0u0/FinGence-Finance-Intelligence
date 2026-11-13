import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LocalAiReportingWorkspace } from "@/components/ai-reporting/local-demo-workspace";
import {
  financialExplanationLocalEnabled,
  financialExplanationRequestAllowed,
} from "@/lib/server/ai-reporting/access";

export const dynamic = "force-dynamic";

export default async function LocalAiReportingPage() {
  if (!financialExplanationLocalEnabled()) notFound();
  const incoming = await headers();
  let request: Request;
  try {
    request = new Request(`http://${incoming.get("host") ?? "invalid"}/ai-reporting`, { headers: incoming });
  } catch {
    notFound();
  }
  if (!financialExplanationRequestAllowed(request)) notFound();
  return <LocalAiReportingWorkspace />;
}
