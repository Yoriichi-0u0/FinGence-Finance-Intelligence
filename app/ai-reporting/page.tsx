import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LocalAiReportingWorkspace } from "@/components/ai-reporting/local-demo-workspace";
import {
  aiReportingLocalEnabled,
  aiReportingRequestAllowed,
} from "@/lib/server/ai-reporting/access";

export const dynamic = "force-dynamic";

export default async function LocalAiReportingPage() {
  if (!aiReportingLocalEnabled()) notFound();
  const incoming = await headers();
  let request: Request;
  try {
    request = new Request(`http://${incoming.get("host") ?? "invalid"}/ai-reporting`, { headers: incoming });
  } catch {
    notFound();
  }
  if (!aiReportingRequestAllowed(request)) notFound();
  return <LocalAiReportingWorkspace />;
}
