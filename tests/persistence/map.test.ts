import { describe, expect, it } from "vitest";
import type { RawCell } from "../../lib/ingestion/models";
import { preparePersistencePlan } from "../../lib/server/persistence/map";
import { clone, header, syntheticResult, validRow } from "./fixtures";

describe("canonical database-ready mapping", () => {
  it.each(["9007199254740993.123456789", "-9007199254740993.123456789", "0"])("preserves exact decimal %s, nulls, identifiers and independent dates", async amount => {
    const result = await syntheticResult(`${header}\n${validRow.replace("9007199254740993.123456789", amount)}`, { dateBasis: "posting_date" });
    const before = clone(result);
    const plan = preparePersistencePlan({ results: [result] });
    const values = plan.datasets[0].records[0].financial_record;
    expect(values).toMatchObject({ source_amount: amount, debit: null, credit: null, balance: null,
      derived_ledger_net: null, reference: "00017", source_transaction_id: "00042", account_code: "00100",
      account_id: "00003", entity_id: "00004", transaction_date: "2026-09-01", posting_date: "2026-09-03",
      canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE" });
    const { validation_messages, ...expected } = result.normalized[0];
    expect(values).toEqual(expected);
    expect(validation_messages).toEqual([]);
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("batch_id");
    expect(values.source_row_id).toBe(result.normalized[0].source_row_id);
    expect(plan.batch).not.toHaveProperty("id");
    expect(plan.kind).toBe("PREPARED");
    expect(result).toEqual(before);
  });
  it("maps every ordered warning issue and preserves all JSON-compatible originals", async () => {
    const result = await syntheticResult(`${header}\n2026-09-01,2026-09-03,-2,,,,,,,MYRR`);
    const originals: RawCell[] = [null, false, true, "00017", { kind: "excel_number", value: "9007199254740993.10" },
      { kind: "excel_date", value: "2026-09-01T00:00:00.000Z" }];
    result.normalized[0].validation_messages = originals.map((originalValue, index) => ({ rule: `SYNTHETIC_${index}`,
      category: "technical", severity: "WARNING", field: "reference", sourceColumn: index % 2 ? "Reference" : null,
      originalValue, message: "Synthetic warning" }));
    result.records[0].issues = clone(result.normalized[0].validation_messages);
    const before = clone(result);
    const plan = preparePersistencePlan({ results: [result] });
    expect(plan.datasets[0].records[0].validation_issues).toEqual(result.normalized[0].validation_messages.map((issue, index) => ({
      issue_ordinal: index, rule: issue.rule, category: issue.category, severity: issue.severity,
      field: issue.field, source_column: issue.sourceColumn, original_value: issue.originalValue, message: issue.message,
    })));
    expect(plan.datasets[0].records[0].validation_issues.map(issue => issue.original_value)).toEqual(originals);
    plan.datasets[0].records[0].validation_issues[0].message = "Changed output";
    const cell = plan.datasets[0].records[0].validation_issues[4].original_value;
    if (cell && typeof cell === "object") cell.value = "Changed output";
    expect(result).toEqual(before);
  });
  it("preserves every populated monetary column as text without reinterpretation", async () => {
    const result = await syntheticResult("transaction_date,debit,credit,amount,balance,reference,description,currency\n2026-09-01,9007199254740993.1,2.000000001,-99.123456789,9007199254740999.123456789,R,Synthetic,MYR", { monetaryMode: "debit_credit" });
    const row = preparePersistencePlan({ results: [result] }).datasets[0].records[0].financial_record;
    expect(row).toMatchObject({ debit: "9007199254740993.1", credit: "2.000000001",
      source_amount: "-99.123456789", balance: "9007199254740999.123456789", derived_ledger_net: "9007199254740991.099999999" });
  });
  it("preserves transformations, exact ledger values and owns nested snapshots", async () => {
    const result = await syntheticResult("transaction_date,debit,credit,reference,description,currency\n2026-09-01,,9007199254740993.1,R,Synthetic,MYR", { monetaryMode: "debit_credit", blankSideAsZero: true });
    const before = clone(result);
    const values = preparePersistencePlan({ results: [result] }).datasets[0].records[0].financial_record;
    expect(values).toMatchObject({ debit: "0", credit: "9007199254740993.1", derived_ledger_net: "-9007199254740993.1", source_amount: null });
    expect(values.transformations).toEqual(result.normalized[0].transformations);
    result.normalized[0].transformations[0].source_column = "Changed input";
    expect(values.transformations).toEqual(before.normalized[0].transformations);
    values.transformations[0].source_column = "Changed output";
    expect(result.normalized[0].transformations[0].source_column).toBe("Changed input");
  });
  it("aggregates selected datasets, replaces reruns and excludes rejected storage", async () => {
    const first = await syntheticResult(`${header}\n${validRow}\n${validRow}\ninvalid,2026-09-03,nope,R,ID,A,B,C,Synthetic,MYR`);
    const second = await syntheticResult(`${header}\n2026-09-02,2026-09-03,-3,R,ID,A,B,C,Synthetic,MYR`);
    const plan = preparePersistencePlan({ results: [first, first, second] });
    expect(plan.batch).toEqual({ source_file: first.dataset.file.name, schema_version: "0.1", ruleset_version: "0.1", ingestion_batch_id: first.context.batchId,
      rows_received: 4, valid_count: 2, warning_count: 1, rejected_count: 1 });
    expect(plan.datasets).toHaveLength(2);
    expect(plan.datasets.flatMap(dataset => dataset.records)).toHaveLength(3);
    expect(plan.datasets.flatMap(dataset => dataset.records).map(record => record.financial_record.ingestion_status)).toEqual(["VALID", "WARNING", "VALID"]);
    expect(plan).not.toHaveProperty("rejected");
    expect(plan).not.toHaveProperty("persisted");
  });
  it("always validates mapping input, including forged database identity fields", async () => {
    const result = await syntheticResult();
    Object.assign(result.normalized[0], { id: "not-a-db-id", batch_id: "not-a-db-id" });
    const row = preparePersistencePlan({ results: [result] }).datasets[0].records[0].financial_record;
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("batch_id");
    result.normalized[0].source_amount = "NaN";
    expect(() => preparePersistencePlan({ results: [result] })).toThrow("Persistence input is invalid or inconsistent.");
  });
});
