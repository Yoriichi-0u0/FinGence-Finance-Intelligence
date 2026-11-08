import { z } from "zod";
import { CANONICAL_FIELDS, type CanonicalCandidate, type Provenance, type RawCell, type ValidationIssue } from "../ingestion/models";

export const EVIDENCE_VERSION = "v2-evidence-0.1" as const;
export type Format = "CSV" | "XLSX" | "PDF" | "IMAGE";
export interface EvidenceItem {
  id: string; value: RawCell; text: string; page: number | null; sheet: string | null;
  row: number | null; column: string | null; address: string | null;
  box: [number, number, number, number] | null; width: number | null; height: number | null;
  coordinateSystem: "TOP_LEFT_POINTS" | "TOP_LEFT_PIXELS" | null;
  table: string | null; header: boolean; method: string; confidence: number | null;
}
export interface EvidenceBundle {
  version: typeof EVIDENCE_VERSION; sourceId: string; filename: string; format: Format;
  bytes: number; items: EvidenceItem[]; warnings: string[]; extractor: string;
  durationMs: number; coverage: "TABLE_ROWS" | "REGIONS_ONLY";
}
export const blueprintSchema = z.strictObject({
  version: z.literal("v2-blueprint-0.1"), sourceId: z.string().min(1).max(100),
  assumptions: z.array(z.string().max(300)).max(20),
  rules: z.array(z.enum(["TRIM_TEXT", "PARSE_DATE", "PARSE_DECIMAL"])).max(3),
  dateBasis: z.enum(["transaction_date", "posting_date"]), dateOrder: z.enum(["ISO", "DMY", "MDY"]),
  numberFormat: z.enum(["plain", "dot_comma", "comma_dot"]),
  monetaryMode: z.enum(["signed_amount", "amount_direction", "debit_credit"]),
  records: z.array(z.strictObject({ evidence: z.array(z.strictObject({
    target: z.enum(CANONICAL_FIELDS), evidenceId: z.string().min(1).max(140), observedText: z.string().max(2000),
  })).min(1).max(16) })).max(50),
});
export type Blueprint = z.infer<typeof blueprintSchema>;
export type FinancialValues = Omit<CanonicalCandidate, keyof Provenance | "derived_ledger_net">;
export interface VerifiedRecord {
  id: string; evidenceIds: string[]; financial: FinancialValues;
  status: "VALID" | "WARNING"; issues: ValidationIssue[];
}
export interface VerificationResult {
  decision: "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";
  policy: "synthetic-iso-no-defaults-0.1";
  approvalKind: "MACHINE_VERIFICATION";
  checks: { name: string; passed: boolean; message: string }[];
  accepted: VerifiedRecord[];
  excluded: { evidenceIds: string[]; issues: ValidationIssue[] }[];
}
export type StageName = "extraction" | "inference" | "rule_synthesis" | "verification" | "financial_records";
export interface Stage { name: StageName; state: "PENDING" | "RUNNING" | "COMPLETED" | "BLOCKED" | "FAILED"; message: string }
export interface InferenceReceipt {
  mode: "LIVE_OPENAI" | "RECORDED_TEST"; model: string; requestId: string | null;
  inputTokens: number; outputTokens: number; estimatedUsd: number; retries: number;
}
export interface V2Result {
  version: "v2-result-0.1"; runId: string; stages: Stage[]; evidence: EvidenceBundle;
  inference: InferenceReceipt | null; blueprint: Blueprint | null; verification: VerificationResult | null;
}
