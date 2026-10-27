/** Hand-authored TEST helper, never imported by the browser or live provider. NOT LLM output. */
import type { Blueprint, EvidenceBundle } from "../../lib/ai-ingestion/contracts";
import type { CanonicalField } from "../../lib/ingestion/models";
const labels: Record<string, CanonicalField> = { "Txn No": "source_transaction_id", "Txn Date": "transaction_date", "Posting Date": "posting_date", "Amount": "source_amount", "CCY": "currency", "Details": "description" };
export function recordedFixtureProposal(bundle: EvidenceBundle): Blueprint {
  const rows = new Map<string, Blueprint["records"][number]>();
  for (const item of bundle.items.filter(i => !i.header && i.row !== null)) {
    const key = `${item.table}:${item.row}`; if (!rows.has(key)) rows.set(key, { evidence: [] });
    if (item.column && labels[item.column]) rows.get(key)!.evidence.push({ target: labels[item.column], evidenceId: item.id, observedText: item.text });
  }
  return { version: "v2-blueprint-0.1", sourceId: bundle.sourceId, assumptions: [], rules: ["TRIM_TEXT", "PARSE_DATE", "PARSE_DECIMAL"], dateBasis: "transaction_date", dateOrder: "ISO", numberFormat: "plain", monetaryMode: "signed_amount", records: [...rows.values()] };
}
