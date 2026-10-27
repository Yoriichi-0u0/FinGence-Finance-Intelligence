import { createAcceptedDataPayload, type IngestionResult } from "../../lib/ingestion";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import type { WarningPolicy } from "../../lib/analytics";
import type { Run03 } from "../../lib/server/ai-ingestion/increment-03/service";

/** Frederick/Izzat: real C1 producer → analytics; no backend, AI or network side effects. */
export function prepareTeamAnalytics(results: readonly IngestionResult[], warningPolicy: WarningPolicy) {
  const payload = createAcceptedDataPayload(results);
  const analysis = analyzeAcceptedDataPayload(payload, warningPolicy);
  return { payload, analysis };
}

/** Experimental diagnostic only: deliberately returns no C1/persistence representation. */
export function describeExperimentalRun(run: Pick<Run03, "version" | "mode" | "verification">) {
  return {
    version: run.version,
    origin: run.mode,
    acceptance: "EXPERIMENTAL_MACHINE_VERIFICATION_ONLY" as const,
    decision: run.verification?.decision ?? "NOT_VERIFIED",
    counts: run.verification?.coverage ?? null,
    bridgeToC1: "NOT_IMPLEMENTED" as const,
  };
}
