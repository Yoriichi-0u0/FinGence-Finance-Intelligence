/** Explicit hand-authored TEST strategy; never an LLM or an automatically approved mapper. */
import type { DateOrder, NumberFormat } from "../../ingestion/models";
import { POLICY_VERSION, type DocumentKind, type SemanticBlueprint, type SemanticEvidence } from "./contracts";
import { contextRule, headingRule } from "./registry";
export function bindRecordedProposal(bundle: SemanticEvidence, documentKind: DocumentKind, conventions: Partial<{ dateOrder: DateOrder; numberFormat: NumberFormat }> = {}): SemanticBlueprint {
  const fields: SemanticBlueprint["fields"] = [];
  for (const table of bundle.tables) for (const id of table.headerIds) {
    const item = bundle.items.find(i => i.id === id)!; const rule = headingRule(item.text);
    fields.push({ id: `field:${fields.length}`, table: table.id, column: item.text, role: rule?.role ?? "unknown", target: rule?.target ?? null, disposition: rule?.disposition ?? "UNRESOLVED", ruleId: rule?.id ?? "unresolved.unknown", reason: "Hand-authored recorded test interpretation; requires independent verification." });
  }
  const rows = new Map<string, SemanticBlueprint["records"][number]>();
  for (const item of bundle.items.filter(i => i.table !== null && !i.header && i.row !== null)) {
    const key = `${item.table}:${item.row}`; const field = fields.find(f => f.table === item.table && f.column === item.column);
    if (!rows.has(key)) rows.set(key, { cells: [] });
    if (field) rows.get(key)!.cells.push({ fieldId: field.id, evidenceId: item.id, observedText: item.text });
  }
  return { version: "v2-blueprint-0.2", policyVersion: POLICY_VERSION, sourceId: bundle.sourceId, documentKind, assumptions: [], rules: ["TRIM_TEXT", "PARSE_DATE", "PARSE_DECIMAL"],
    conventions: { dateOrder: conventions.dateOrder ?? "ISO", numberFormat: conventions.numberFormat ?? "plain", dateBasis: "transaction_date", monetaryMode: fields.some(f => f.role === "debit" || f.role === "credit") ? "debit_credit" : fields.some(f => f.role === "direction") ? "amount_direction" : "signed_amount" },
    fields, records: [...rows.values()].filter(r => r.cells.some(c => c.observedText.trim())),
    context: bundle.items.filter(i => i.table === null && i.text.trim()).map(i => ({ evidenceId: i.id, ruleId: contextRule(i.text) ?? "unresolved.context", disposition: contextRule(i.text) ? "SUPPORTING_METADATA" : "UNRESOLVED" })),
  };
}
