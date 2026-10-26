import { z } from "zod";
import { CANONICAL_FIELDS } from "../ingestion/models";
import { blueprintSchema, type Blueprint, type EvidenceBundle, type InferenceReceipt } from "./contracts";
import { verifyAndExecute } from "./verify";

const templateSchema = z.strictObject({ version: z.literal("v2-template-0.1"), origin: z.enum(["LIVE_OPENAI", "RECORDED_TEST"]),
  format: z.enum(["CSV", "XLSX", "PDF", "IMAGE"]), policy: z.literal("synthetic-iso-no-defaults-0.1"),
  settings: blueprintSchema.pick({ dateBasis: true, dateOrder: true, numberFormat: true, monetaryMode: true, rules: true }),
  columns: z.array(z.strictObject({ column: z.string(), target: z.enum(CANONICAL_FIELDS) })).min(1).max(16),
});
export type ReusableBlueprint = z.infer<typeof templateSchema>;
export function createReusableBlueprint(bundle: EvidenceBundle, blueprint: Blueprint, origin: InferenceReceipt["mode"]): ReusableBlueprint {
  const verification = verifyAndExecute(bundle, blueprint);
  if (verification.decision !== "VERIFIED" || verification.excluded.length) throw new Error("Only a fully verified synthetic blueprint may become a reusable template.");
  const columns = blueprint.records[0].evidence.map(binding => {
    const column = bundle.items.find(i => i.id === binding.evidenceId)?.column;
    if (!column) throw new Error("A stable source column selector is required.");
    return { column, target: binding.target };
  });
  // All row bindings must use the same selector layout; do not generalize incompatible tables.
  for (const record of blueprint.records) for (const binding of record.evidence) {
    const column = bundle.items.find(i => i.id === binding.evidenceId)?.column;
    if (!columns.some(c => c.column === column && c.target === binding.target)) throw new Error("Inconsistent row layouts cannot be generalized.");
  }
  return templateSchema.parse({ version: "v2-template-0.1", origin, format: bundle.format, policy: verification.policy,
    settings: { dateBasis: blueprint.dateBasis, dateOrder: blueprint.dateOrder, numberFormat: blueprint.numberFormat, monetaryMode: blueprint.monetaryMode, rules: [...blueprint.rules] }, columns });
}
export function bindReusableBlueprint(input: unknown, bundle: EvidenceBundle): Blueprint {
  const template = templateSchema.parse(input);
  if (bundle.format !== template.format) throw new Error("Template format mismatch.");
  const rows = new Map<string, Blueprint["records"][number]>();
  for (const item of bundle.items.filter(i => !i.header && i.row !== null)) {
    const key = `${item.table}:${item.row}`; if (!rows.has(key)) rows.set(key, { evidence: [] });
    const column = template.columns.find(c => c.column === item.column);
    if (column) rows.get(key)!.evidence.push({ target: column.target, evidenceId: item.id, observedText: item.text });
  }
  if ([...rows.values()].some(r => r.evidence.length !== template.columns.length)) throw new Error("Source columns changed; new inference/review is required.");
  return blueprintSchema.parse({ version: "v2-blueprint-0.1", sourceId: bundle.sourceId, assumptions: [], ...template.settings, records: [...rows.values()] });
}
