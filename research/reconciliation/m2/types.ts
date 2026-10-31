import type { Direction, Role } from "../types";
export type Split = "train" | "development" | "heldout";
export type Basis = "SIGNED_CASH" | "AMOUNT_DIRECTION" | "CASH_DEBIT_CREDIT" | "EXPENSE_DEBIT_CREDIT" | "SIGNED_EXPENSE";
export type Family = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U";
export type Decision = "SUGGEST_PAIR" | "ABSTAIN_AMBIGUOUS" | "ABSTAIN_INSUFFICIENT" | "UNRESOLVED_GROUP" | "UNRESOLVED_UNMATCHED";
export interface Template {
  id: string; split: Split; role: Role; systemId: string; accountId: string;
  basis: Basis; dateBasis: "TRANSACTION_DATE" | "POSTING_DATE";
  format: "CSV" | "XLSX_STYLE" | "JOURNAL_EXPORT";
  sourceDateFormat: "ISO" | "DMY" | "MDY";
  fields: Record<string, string>; convention: string;
}
export interface Transaction {
  id: string; role: Role; templateId: string; systemId: string; accountId: string;
  sourceRowId: string; sourceTransactionId: string | null;
  provenance: { file: string; sheet: string | null; row: number; synthetic: true };
  eligibility: "SYNTHETIC_RESEARCH_ELIGIBLE";
  amount: string; sourceAmount: string | null; debit: string | null; credit: string | null;
  currency: string; monetaryBasis: Basis; direction: Direction;
  transactionDate: string | null; postingDate: string | null;
  canonicalDate: string; canonicalDateBasis: "TRANSACTION_DATE" | "POSTING_DATE";
  description: string; counterparty: string | null; reference: string | null;
}
export interface SplitInput {
  version: string; seed: string; split: Split; period: string;
  templates: Template[]; records: Transaction[];
}
export interface Relationship {
  id: string; economicId: string; family: Family; kind: "PAIR" | "GROUP" | "PARTIAL";
  bankIds: string[]; ledgerIds: string[]; remainingAmount: string | null;
}
export type NegativeReason = "AMOUNT" | "CURRENCY" | "COUNTERPARTY" | "DISTINCT_EVENT";
export interface Truth {
  version: string; seed: string; split: Split;
  relationships: Relationship[];
  negatives: { bankId: string; ledgerId: string; reason: NegativeReason }[];
  unmatched: { recordId: string; economicId: string; family: Family }[];
  ambiguous: { id: string; family: Family; bankIds: string[]; ledgerIds: string[] }[];
  outcomes: { subjectId: string; decision: Decision }[];
  cases: { id: string; family: Family; recordIds: string[] }[];
}
export interface Benchmark { version: string; seed: string; inputs: SplitInput[]; annotations: Truth[] }
export interface EligibilityExample { id: string; expected: "REJECT"; reason: string; input: unknown }
