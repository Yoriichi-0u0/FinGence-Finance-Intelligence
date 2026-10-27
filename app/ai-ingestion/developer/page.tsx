import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { developerRequestAllowed } from "@/lib/server/ai-ingestion/increment-02/replay";
import DeveloperReplay from "@/components/ai-ingestion-02/developer-replay";
export const dynamic = "force-dynamic";
export default async function DeveloperEvaluationPage() {
  const h = await headers();
  let request: Request;
  try { request = new Request(`http://${h.get("host") ?? "invalid"}/ai-ingestion/developer`, { headers: h }); } catch { notFound(); }
  if (!developerRequestAllowed(request)) notFound();
  return <DeveloperReplay />;
}
