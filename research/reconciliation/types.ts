/** Synthetic research contract; deliberately unrelated to ingestion approval. */
export type Role = "BANK" | "LEDGER";
export type Direction = "INFLOW" | "OUTFLOW";
export type MonetaryBasis = "SIGNED_CASH" | "AMOUNT_DIRECTION" | "CASH_DEBIT_CREDIT" | "EXPENSE_DEBIT_CREDIT";
export type Decision = "SUGGEST_PAIR" | "ABSTAIN_AMBIGUOUS" | "ABSTAIN_INSUFFICIENT" | "UNRESOLVED_GROUP";
export type Family = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J";
export interface SourceTemplate {
  id: string;
  role: Role;
  systemId: string;
  accountId: string;
  monetaryBasis: MonetaryBasis;
  dateBasis: "TRANSACTION_DATE" | "POSTING_DATE";
  columns: readonly string[];
  convention: string;
}
export interface ResearchRecord {
  id: string;
  role: Role;
  systemId: string;
  templateId: string;
  sourceRowId: string;
  sourceTransactionId: string | null;
  provenance: { file: string; sheet: string | null; row: number; synthetic: true };
  /** Nonnegative economic cash magnitude; original signed/debit/credit fields remain separate. */
  amount: string;
  sourceAmount: string | null;
  debit: string | null;
  credit: string | null;
  currency: string;
  monetaryBasis: MonetaryBasis;
  direction: Direction;
  accountId: string;
  transactionDate: string | null;
  postingDate: string | null;
  canonicalDate: string;
  canonicalDateBasis: "TRANSACTION_DATE" | "POSTING_DATE";
  description: string;
  counterparty: string | null;
  reference: string | null;
}
export interface EconomicRelationship {
  id: string;
  kind: "ONE_TO_ONE" | "GROUP";
  bankIds: string[];
  ledgerIds: string[];
  family: Family;
  rationale: string;
}
export interface GroundTruth {
  /** Privileged author annotations; never candidate/model input. */
  relationships: EconomicRelationship[];
  nonmatches: { bankId: string; ledgerId: string; reason: "AMOUNT" | "CURRENCY" | "DISTINCT_EVENT" }[];
  unmatchedIds: string[];
  ambiguousCases: { id: string; bankIds: string[]; ledgerIds: string[]; rationale: string }[];
  outcomes: { relationshipId: string; decision: Decision; reason: string }[];
  cases: { id: string; family: Family; recordIds: string[] }[];
}
export interface Dataset {
  generatorVersion: string;
  config: { seed: string; pilot: "M1" };
  templates: SourceTemplate[];
  records: ResearchRecord[];
  groundTruth: GroundTruth;
}
