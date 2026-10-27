import { z } from "zod";
import { CANONICAL_FIELDS, type DateOrder, type NumberFormat, type ValidationIssue } from "../../ingestion/models";
import type { EvidenceBundle, FinancialValues, InferenceReceipt } from "../contracts";

export const POLICY_VERSION = "experimental-financial-terminology-0.2" as const;
export const documentKinds = ["TRANSACTION_TABLE", "BANK_STATEMENT", "GENERAL_LEDGER", "INVOICE", "RECEIPT", "UNKNOWN"] as const;
export type DocumentKind = typeof documentKinds[number];
export const roles = ["transaction_id", "transaction_date", "posting_date", "amount", "debit", "credit", "direction", "currency", "description", "reference", "account_code", "account_id", "entity_id", "balance", "counterparty", "bank_in", "bank_out", "department", "prepared_by", "page_number", "note", "invoice_field", "unknown"] as const;
export type SemanticRole = typeof roles[number];
export const dispositions = ["FINANCIAL", "SUPPORTING_METADATA", "NONFINANCIAL_NARRATIVE", "UNRESOLVED"] as const;
const finite = z.number().finite();
export const workerEvidenceSchema = z.object({ items: z.array(z.object({
  value: z.string().max(2000), text: z.string().max(2000), page: z.number().int().min(1).max(4).nullable(), sheet: z.string().max(200).nullable(),
  row: z.number().int().min(1).max(61).nullable(), column: z.string().max(200).nullable(), address: z.string().nullable(),
  box: z.tuple([finite, finite, finite, finite]).nullable(), width: finite.positive().nullable(), height: finite.positive().nullable(), coordinateSystem: z.enum(["TOP_LEFT_POINTS", "TOP_LEFT_PIXELS"]).nullable(),
  table: z.string().max(100).nullable(), header: z.boolean(), confidence: finite.min(0).max(1).nullable(), method: z.string().max(100),
})).max(2000), warnings: z.array(z.string().max(500)).max(150), coverage: z.enum(["TABLE_ROWS", "REGIONS_ONLY"]), extractor: z.string().max(200) });
export interface SemanticEvidence extends Omit<EvidenceBundle, "version"> {
  version: "v2-evidence-0.2";
  tables: { id: string; headerRow: number; headerIds: string[] }[];
}
export const fieldSchema = z.strictObject({ id: z.string().min(1).max(100), table: z.string().min(1).max(100), column: z.string().max(200),
  role: z.enum(roles), target: z.enum(CANONICAL_FIELDS).nullable(), disposition: z.enum(dispositions), ruleId: z.string().max(100), reason: z.string().max(500) });
export const semanticBlueprintSchema = z.strictObject({
  version: z.literal("v2-blueprint-0.2"), policyVersion: z.literal(POLICY_VERSION), sourceId: z.string().regex(/^[a-f0-9]{64}$/),
  documentKind: z.enum(documentKinds), assumptions: z.array(z.string().max(300)).max(20),
  conventions: z.strictObject({ dateOrder: z.enum(["ISO", "DMY", "MDY"]), numberFormat: z.enum(["plain", "dot_comma", "comma_dot"]),
    dateBasis: z.literal("transaction_date"), monetaryMode: z.enum(["signed_amount", "amount_direction", "debit_credit"]) }),
  rules: z.tuple([z.literal("TRIM_TEXT"), z.literal("PARSE_DATE"), z.literal("PARSE_DECIMAL")]),
  fields: z.array(fieldSchema).max(64),
  context: z.array(z.strictObject({ evidenceId: z.string().max(140), ruleId: z.string().max(100), disposition: z.enum(["SUPPORTING_METADATA", "NONFINANCIAL_NARRATIVE", "UNRESOLVED"]) })).max(150),
  records: z.array(z.strictObject({ cells: z.array(z.strictObject({ fieldId: z.string().max(100), evidenceId: z.string().max(140), observedText: z.string().max(2000) })).min(1).max(16) })).max(50),
});
export type SemanticBlueprint = z.infer<typeof semanticBlueprintSchema>;
export type FieldDisposition = SemanticBlueprint["fields"][number];
export interface DecisionCheck { code: string; passed: boolean; detail: string; evidenceIds: string[] }
export interface HeldRecord { id: string; evidenceIds: string[]; reasons: string[] }
export type SemanticOrigin = InferenceReceipt["mode"] | "LIVE_GROQ" | "LIVE_OLLAMA";
export interface SemanticVerification {
  version: "v2-verification-0.2"; policyVersion: typeof POLICY_VERSION; proposalOrigin: SemanticOrigin;
  approvalKind: "MACHINE_VERIFICATION"; decision: "VERIFIED" | "PARTIAL" | "NEEDS_REVIEW" | "REJECTED";
  checks: DecisionCheck[]; documentReasons: string[]; dispositions: FieldDisposition[]; contextDispositions: SemanticBlueprint["context"];
  accepted: { id: string; evidenceIds: string[]; financial: FinancialValues; status: "VALID" | "WARNING"; issues: ValidationIssue[] }[];
  rejected: (HeldRecord & { issues: ValidationIssue[] })[]; unresolved: HeldRecord[];
  coverage: { sourceRows: number; rowCountEstablished: boolean; accepted: number; rejected: number; unresolved: number; populatedCells: number; accountedCells: number };
}
export interface ConventionResolution { valid: boolean; dateOrder: DateOrder; numberFormat: NumberFormat; reasons: string[] }
