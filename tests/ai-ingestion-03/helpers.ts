import { readFileSync } from "node:fs";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { policyHash } from "../../lib/ai-ingestion/increment-03/plan";
export async function bankEvidence() {
  return extractSemanticEvidence(readFileSync("public/samples/ai-ingestion-increment-02/precision.csv"), "do-not-leak-precision.csv");
}
export function proposedPlan(bundle: Awaited<ReturnType<typeof bankEvidence>>) {
  const rules = ["identity.transaction", "date.transaction", "date.posting", "money.amount", "source.currency", "text.description", "identity.reference"];
  return { version: "v2-plan-0.3", policyVersion: "experimental-financial-terminology-0.2", policyHash,
    documentKind: "BANK_STATEMENT", assumptions: [], conventions: { dateOrder: "ISO", numberFormat: "plain", dateBasis: "transaction_date", monetaryMode: "signed_amount" },
    fields: bundle.tables.flatMap(t => t.headerIds.map((id, n) => ({ headerId: id, ruleId: rules[n], reason: "Source heading and bank context" }))),
    context: bundle.items.filter(i => i.table === null && i.text.trim()).map(i => ({ evidenceId: i.id, ruleId: "context.document-label", disposition: "SUPPORTING_METADATA" })),
  };
}
