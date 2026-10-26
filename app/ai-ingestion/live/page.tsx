import { notFound } from "next/navigation";
import { liveEnabled03 } from "@/lib/server/ai-ingestion/increment-03/service";
import { LiveDocument03 } from "@/components/ai-ingestion-03/live-document";
export const dynamic = "force-dynamic";
export default function LivePage03() {
  if (!liveEnabled03()) notFound();
  return <LiveDocument03 />;
}
