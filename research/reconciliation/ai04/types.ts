import type { Transaction, Template } from "../m2/types";
export type Split = "train" | "development";
/** Verification-only projection: no description, score, economic ID or annotation. */
export type RecordEvidence = Readonly<Omit<Transaction, "description">>;
export interface VerificationInput {
  version: "ai01-m2/1.1.0"; split: Split;
  records: readonly RecordEvidence[];
}
export type SourceTemplate = Template;
export interface Proposal { bankId: string; ledgerId: string; algorithm: "E0" | "E1" | "E2b"; topology: "PAIR" | "GROUP" | "PARTIAL" }
export interface Policy {
  version: "ai04-policy/1.0.0"; dateField: "canonicalDate"; maxDays: 2;
  scope: "SYNTHETIC_SPLIT_COHORT"; identity: "EXACT_REFERENCE_AND_COUNTERPARTY";
}
export interface Check { code: string; status: "PASS" | "FAIL" | "NOT_VERIFIED"; evidence: readonly string[] }
export type Disposition = "VERIFIED_SUGGESTION" | "UNRESOLVED_REVIEW" | "BLOCKED_PROPOSAL";
export interface Decision extends Proposal {
  verifierVersion: string; policyVersion: string; checks: Check[]; reasons: string[]; disposition: Disposition;
}
export interface VerificationRun {
  verifierVersion: string; policy: Policy; datasetVersion: string; split: Split;
  inputFingerprint: string; proposalFingerprint: string; fingerprint: string;
  decisions: Decision[];
}
