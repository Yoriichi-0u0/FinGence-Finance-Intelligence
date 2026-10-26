import type { CanonicalField } from "../../ingestion/models";
import { POLICY_VERSION, type DocumentKind, type FieldDisposition, type SemanticRole } from "./contracts";
export interface TermRule { id: string; role: SemanticRole; target: CanonicalField | null; disposition: FieldDisposition["disposition"]; headings: readonly string[]; contexts?: readonly DocumentKind[]; valueKind: "TEXT" | "DATE" | "DECIMAL" | "CODE" | "METADATA" }
const term = (id: string, role: SemanticRole, target: CanonicalField | null, valueKind: TermRule["valueKind"], headings: string[], disposition: FieldDisposition["disposition"] = "FINANCIAL", contexts?: DocumentKind[]): TermRule => ({ id, role, target, valueKind, headings, disposition, contexts });
export const terminologyRegistry = {
  version: POLICY_VERSION, authority: "EXPERIMENTAL_SYNTHETIC_POLICY", clientApproved: false,
  exclusionValues: {
    "metadata.department": ["Operations", "Finance", "Research"],
    "metadata.preparer": ["Synthetic Tester", "Demo Operator", "Clerk"],
    "metadata.page": ["1", "2", "3", "4"],
    "narrative.note": ["Reviewed by clerk", "Pending filing", "Filed", "Checked", "Scanned copy"],
  },
  rules: [
    term("identity.transaction", "transaction_id", "source_transaction_id", "TEXT", ["txn no", "transaction id", "txn id", "transaction code", "source transaction id", "voucher no"]),
    term("date.transaction", "transaction_date", "transaction_date", "DATE", ["txn date", "transaction date", "date"]),
    term("date.posting", "posting_date", "posting_date", "DATE", ["posting date"]),
    term("money.amount", "amount", "source_amount", "DECIMAL", ["amount", "source amount", "transaction amount"]),
    term("ledger.debit", "debit", "debit", "DECIMAL", ["debit", "debit amount", "dr value"], "FINANCIAL", ["GENERAL_LEDGER"]),
    term("ledger.credit", "credit", "credit", "DECIMAL", ["credit", "credit amount", "cr value"], "FINANCIAL", ["GENERAL_LEDGER"]),
    term("source.direction", "direction", "entry_side", "CODE", ["entry side", "debit credit", "direction"]),
    term("source.currency", "currency", "currency", "CODE", ["currency", "ccy", "currency code"]),
    term("text.description", "description", "description", "TEXT", ["description", "details", "narration", "transaction narrative", "payment narrative"]),
    term("identity.reference", "reference", "reference", "TEXT", ["reference", "ref"]),
    ...(["account_code", "account_id", "entity_id", "counterparty", "balance"] as const).map(field => term(`source.${field}`, field, field, field === "balance" ? "DECIMAL" : "TEXT", [field.replaceAll("_", " ")])),
    term("bank.in", "bank_in", null, "DECIMAL", ["money in", "payment in", "inflow"], "UNRESOLVED", ["BANK_STATEMENT"]),
    term("bank.out", "bank_out", null, "DECIMAL", ["money out", "payment out", "outflow"], "UNRESOLVED", ["BANK_STATEMENT"]),
    term("metadata.department", "department", null, "METADATA", ["department", "department code"], "SUPPORTING_METADATA"),
    term("metadata.preparer", "prepared_by", null, "METADATA", ["prepared by", "operator"], "SUPPORTING_METADATA"),
    term("metadata.page", "page_number", null, "METADATA", ["page number", "page no"], "SUPPORTING_METADATA"),
    term("narrative.note", "note", null, "METADATA", ["internal note", "page note"], "NONFINANCIAL_NARRATIVE"),
    term("document.invoice", "invoice_field", null, "TEXT", ["item", "quantity", "unit price", "line total", "total", "subtotal", "tax"], "UNRESOLVED", ["INVOICE", "RECEIPT"]),
  ] satisfies TermRule[],
};
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function headingRule(column: string): TermRule | null {
  const key = words(column).replaceAll(" ", "");
  const exact = terminologyRegistry.rules.filter(r => r.headings.some(h => words(h).replaceAll(" ", "") === key));
  if (exact.length === 1) return exact[0];
  // Reviewed term composition allows unfamiliar combinations, never fuzzy similarity.
  const tokens = words(column).split(" ");
  if (tokens.length === 2 && ["transaction", "payment"].includes(tokens[0]) && ["narrative", "description", "narration"].includes(tokens[1])) return terminologyRegistry.rules.find(r => r.id === "text.description")!;
  return null;
}
export function contextRule(text: string): string | null {
  if (/\b(?:ignore.*instructions|run sql|reveal.*secret)\b/i.test(text)) return null;
  if (/^(?:SYNTHETIC FINANCIAL STATEMENT|SYNTHETIC|NOT CLIENT DATA|BANK STATEMENT|GENERAL LEDGER|INVOICE|RECEIPT|TRANSACTION TABLE)(?:\s*-\s*(?:SYNTHETIC|NOT CLIENT DATA))*$/i.test(text.trim())) return "context.document-label";
  const metadata = /^(Prepared by|Department|Page)\s*[:#]\s*([^\n]{1,100})$/i.exec(text.trim());
  if (metadata && exclusionValueAllowed(metadata[2], ({ "prepared by": "metadata.preparer", department: "metadata.department", page: "metadata.page" } as Record<string, string>)[metadata[1].toLowerCase()])) return "context.metadata";
  return null;
}
export function observedDocumentKind(texts: readonly string[]): DocumentKind | null {
  const kinds: DocumentKind[] = [];
  for (const [pattern, kind] of [[/\bBANK STATEMENT\b/i, "BANK_STATEMENT"], [/\bGENERAL LEDGER\b/i, "GENERAL_LEDGER"], [/\bINVOICE\b/i, "INVOICE"], [/\bRECEIPT\b/i, "RECEIPT"]] as const) if (texts.some(t => pattern.test(t))) kinds.push(kind);
  return kinds.length === 1 ? kinds[0] : kinds.length ? "UNKNOWN" : null;
}
export function exclusionValueAllowed(value: string, ruleId: string): boolean {
  // A heading alone never proves that arbitrary contents are nonfinancial.
  // Only narrowly enumerated synthetic administrative values may be excluded.
  if (!value.trim()) return true;
  const allowed = terminologyRegistry.exclusionValues[ruleId as keyof typeof terminologyRegistry.exclusionValues];
  return Boolean(allowed?.some(v => v.toLowerCase() === value.trim().toLowerCase()));
}
