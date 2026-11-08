import { describe, expect, it } from "vitest";
import {
  analyzeAcceptedDataPayload,
  type AcceptedDataPayload,
  type AcceptedRecordPayload,
} from "../lib/analytics/accepted-data-adapter";

function record(overrides: Partial<AcceptedRecordPayload> = {}): AcceptedRecordPayload {
  return {
    source_row_number: 2, source_row_id: "sha:0:2",
    transaction_date: "2026-09-01", posting_date: null,
    canonical_date: "2026-09-01", canonical_date_basis: "TRANSACTION_DATE",
    reference: "REF-1", source_transaction_id: null, account_code: "00100",
    account_id: null, entity_id: null, description: "Synthetic transaction",
    counterparty: null, debit: "10.10", credit: "0.10", source_amount: null,
    balance: null, entry_side: "DEBIT", monetary_basis: "debit_credit",
    currency: "MYR", currency_basis: "SOURCE", transformations: [],
    ingestion_status: "VALID", validation_messages: [], ...overrides,
  };
}

function payload(records: AcceptedRecordPayload[] = [record()]): AcceptedDataPayload {
  return {
    schema_version: "0.1", ruleset_version: "0.1",
    datasets: [{
      dataset_id: "sha:0", source_file: "ledger.csv", file_sha256: "a".repeat(64), source_sheet: null,
      source_system: "Ledger", ingestion_batch_id: "batch-1", ingested_at: "2026-10-02T00:00:00.000Z",
      summary: { rowsReceived: records.length, accepted: records.length, valid: records.length, warning: 0, rejected: 0, requiredCompleteness: 100, duplicateRows: 0 },
      normalized: records,
    }],
  };
}

describe("C1 accepted-data analytics adapter", () => {
  it("reconstructs dataset provenance and derives ledger net exactly", () => {
    const result = analyzeAcceptedDataPayload(payload([
      record({ debit: "9007199254740993.10", credit: "0.10" }),
    ]), "include", { "sha:0": { convention: "DEBIT_MINUS_CREDIT", approvalReference: "Synthetic test approval; not a client convention" } });
    expect(result.prepared.records[0]).toMatchObject({
      source_system: "Ledger", source_file: "ledger.csv", source_sheet: null,
      file_sha256: "a".repeat(64), ingestion_batch_id: "batch-1",
      ingested_at: "2026-10-02T00:00:00.000Z",
    });
    expect(result.ledgerInterpretation.records[0]).toMatchObject({ status: "AVAILABLE", value: "9007199254740993" });
    expect(result.prepared.records[0]).not.toHaveProperty("derived_ledger_net");
  });

  it("does not derive ledger net for bank/source-amount records", () => {
    const result = analyzeAcceptedDataPayload(payload([
      record({ monetary_basis: "source_amount_with_direction", source_amount: "12.30", debit: null, credit: null }),
    ]));
    expect(result.ledgerInterpretation.records[0]).toMatchObject({ status: "NOT_APPLICABLE", value: null });
  });

  it("does not assume a missing debit or credit is zero", () => {
    const result = analyzeAcceptedDataPayload(payload([record({ credit: null })]));
    expect(result.ledgerInterpretation.records[0]).toMatchObject({ status: "UNAVAILABLE", value: null });
  });

  it("applies warning policy and retains excluded warning records", () => {
    const result = analyzeAcceptedDataPayload(payload([
      record(), record({ source_row_number: 3, source_row_id: "sha:0:3", ingestion_status: "WARNING" }),
    ]), "exclude");
    expect(result.prepared.counts).toMatchObject({ received: 2, included: 1, warning: 1, excludedWarnings: 1 });
    expect(result.prepared.excludedWarningRecords[0].source_row_id).toBe("sha:0:3");
  });

  it("rejects incompatible envelope versions", () => {
    const input = payload();
    input.schema_version = "0.2";
    expect(() => analyzeAcceptedDataPayload(input)).toThrow(/Unsupported schema_version/);
  });

  it("rejects missing provenance instead of fabricating it", () => {
    const input = payload();
    input.datasets[0].source_file = "";
    expect(() => analyzeAcceptedDataPayload(input)).toThrow(/Missing required provenance/);
  });

  it("rejects unexpected record statuses", () => {
    const invalid = { ...record(), ingestion_status: "REJECTED" } as unknown as AcceptedRecordPayload;
    expect(() => analyzeAcceptedDataPayload(payload([invalid]))).toThrow(/Unexpected accepted-record status/);
  });
});


describe("interpretation availability and producer safeguards", () => {
  it("does not publish a complete-looking net when only one of two ledger datasets has approval", () => {
    const input = payload([record()]);
    const second = structuredClone(input.datasets[0]);
    second.dataset_id = "second:0"; second.source_file = "second.csv";
    second.normalized[0].source_row_id = "second:0:2";
    input.datasets.push(second);
    const run = analyzeAcceptedDataPayload(input, "include", { "sha:0": { convention: "DEBIT_MINUS_CREDIT", approvalReference: "Synthetic approval A" } });
    expect(run.ledgerInterpretation).toMatchObject({ available: 1, unavailable: 1 });
    expect(run.monthlyAggregates[0]).toMatchObject({ debitTotal: "20.2", creditTotal: "0.2", ledgerNetTotal: null, transactionCount: 2 });
  });

  it.each(["schema_version", "ruleset_version"] as const)("preflights %s before accessing datasets", field => {
    const input = { ...payload(), [field]: "9.0", get datasets(): AcceptedDataPayload["datasets"] { throw new Error("DATASETS_ACCESSED_TOO_EARLY"); } };
    expect(() => analyzeAcceptedDataPayload(input)).toThrow("Unsupported " + field);
  });

  it("preserves independent dates, identifiers, warnings and transformations without mutating C1", () => {
    const input = payload([record({ reference: "00017", source_transaction_id: "00000", debit: "9007199254740993.1", credit: "0",
      transaction_date: "2026-09-01", posting_date: "2026-09-03", canonical_date: "2026-09-03", canonical_date_basis: "POSTING_DATE",
      currency_basis: "DATASET_DEFAULT", ingestion_status: "WARNING",
      validation_messages: [{ rule: "FUTURE_NOTICE", category: "business", severity: "WARNING", field: "reference", sourceColumn: "Ref", originalValue: "00017", message: "Keep the warning" }],
      transformations: [{ field: "credit", source_column: "Credit", original_value: null, normalized_value: "0", rule: "APPROVED_BLANK_SIDE_ZERO" }],
    })]);
    const before = structuredClone(input);
    const run = analyzeAcceptedDataPayload(input);
    expect(run.prepared.records[0]).toMatchObject(input.datasets[0].normalized[0]);
    expect(run.monthlyAggregates[0].debitTotal).toBe("9007199254740993.1");
    expect(input).toEqual(before);
    run.prepared.records[0].validation_messages[0].message = "Changed output";
    expect(input).toEqual(before);
  });

  it("requires an explicit warning policy rather than silently choosing", () => {
    expect(() => analyzeAcceptedDataPayload(payload(), "unknown" as "include")).toThrow("WARNING policy");
  });
});
