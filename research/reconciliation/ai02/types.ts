import type { featuresOf } from "../m2/features";
export type Features = ReturnType<typeof featuresOf>;
export type Method = "E0" | "E1";
export type ResearchSplit = "train" | "development";
export interface InputRecord { candidateId: string; role: "BANK" | "LEDGER"; features: Features }
export interface Input { version: string; split: ResearchSplit; candidates: readonly InputRecord[] }
export interface Config {
  date: { field: "canonicalDate" | "transactionDate" | "postingDate"; maxDays: number };
  threshold: number; margin: number;
}
export interface Pair { bankId: string; ledgerId: string; dateGapDays: number }
export interface ScoredPair extends Pair {
  method: Method; score: number; supported: boolean; reasons: string[];
  evidence: { reference: number | null; description: number; counterparty: number | null };
  /** Worst rank of an equal-score tie; identity sorting is presentation only. */
  rank: number;
}
export interface Outcome {
  recordId: string; role: "BANK" | "LEDGER";
  state: "SUGGEST_PAIR" | "AMBIGUOUS" | "UNRESOLVED";
  partnerId: string | null; candidateIds: string[];
  reason: "MUTUAL_UNIQUE_SUPPORT" | "NO_ELIGIBLE_PAIR_GROUPING_NOT_SUPPORTED" | "INSUFFICIENT_SUPPORT" | "TIED_OR_CLOSE" | "ASSIGNMENT_CONFLICT";
}
export interface Run {
  method: Method; algorithmVersion: string; datasetVersion: string; split: ResearchSplit; config: Config;
  candidateCount: number; blockedCount: number; blockingReasons: Record<string, number>;
  candidates: ScoredPair[]; outcomes: Outcome[];
  suggestions: { bankId: string; ledgerId: string }[];
  processingMs: number; fingerprint: string;
}
export const ALGORITHM_VERSION = "ai02/1.0.0";
export const DATE_POLICY = Object.freeze({ field: "canonicalDate" as const, maxDays: 2 });
export const EXACT_CONFIG: Config = { date: DATE_POLICY, threshold: 1, margin: 0 };
