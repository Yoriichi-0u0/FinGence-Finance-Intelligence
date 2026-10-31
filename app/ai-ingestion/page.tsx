import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { localAccessAllowed } from "../../lib/server/ai-ingestion/service";
import {m3LocalEnabled} from '../../lib/server/financial-m3/runtime';
import {m4LocalEnabled} from '../../lib/server/ai-ingestion/m4/runtime';
import M2Workspace from "../../components/ai-ingestion-m2/workspace";

export const dynamic = "force-dynamic";

export default async function LocalAIIngestionPage() {
  if (process.env.NODE_ENV !== "development" || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.VERCEL) notFound();
  const incoming = await headers();
  let request: Request;
  try { request = new Request(`http://${incoming.get("host") ?? "invalid"}/ai-ingestion`, { headers: incoming }); }
  catch { notFound(); }
  if (!localAccessAllowed(request)) notFound();
  return <M2Workspace financialConsumers={m3LocalEnabled()} modelBoundary={m4LocalEnabled()} />;
}
