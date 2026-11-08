import { notFound } from "next/navigation";
import { LocalExperiment } from "@/components/ai-ingestion-v2-i1/local-experiment";
export const dynamic = "force-dynamic";
export default function V2I1Page() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.FINGENCE_AI_LOCAL !== "1" || process.env.FINGENCE_V2_I1_LOCAL !== "1") notFound();
  return <LocalExperiment />;
}
