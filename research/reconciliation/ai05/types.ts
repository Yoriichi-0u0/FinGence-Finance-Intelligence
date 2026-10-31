import type { Input, Run, ScoredPair } from "../ai02/types";
import type { SemanticPair } from "../ai03/types";
import type { VerificationInput, VerificationRun } from "../ai04/types";
import type { Split } from "../m2/types";
export type EvaluationInput = Omit<Input, "split"> & { split: Split };
export type EvidenceInput = Omit<VerificationInput, "split"> & { split: Split };
export type EvaluationVerification = Omit<VerificationRun, "split"> & { split: Split };
export interface EvaluationRun extends Omit<Run, "split" | "method" | "candidates"> {
  split: Split; method: "E0" | "E1" | "E2b"; candidates: (ScoredPair | SemanticPair)[];
  timings: { candidateMs: number; rankingMs: number; embeddingWallMs: number; endToEndMs: number };
  inferenceKind?: string; modelMetadata?: Record<string, unknown>;
}
export const ADAPTER_VERSION = "ai05-heldout-adapter/1.0.0";
