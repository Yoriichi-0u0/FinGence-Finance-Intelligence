import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { InvalidTransactionContractError, parseTransactionListFilters, projectTransactionRow } from "../../lib/server/api/transaction-contract";

const row = {
  id: "f5cc1077-3a76-4e9d-af8e-e916f07f08b4",
  batch_id: "adcba6b1-7d4a-4787-8896-3dfb25f4ee61",
  ingestion_batch_id: "producer-batch-001", source_row_id: "00017",
  canonical_date: "2026-09-01", transaction_date: "2026-09-01", posting_date: "2026-09-03",
  canonical_date_basis: "TRANSACTION_DATE", reference: "00042", source_transaction_id: "00003",
  description: "Synthetic financial row", account_code: "00100", monetary_basis: "source_signed_amount",
  debit: null, credit: null, source_amount: "9007199254740993.123456789",
  derived_ledger_net: null, balance: null, currency: "MYR",
  currency_basis: "SOURCE", entry_side: null, ingestion_status: "VALID",
};

describe("Phase 6A transaction request contract", () => {
  it("defaults conservatively", () => {
    expect(parseTransactionListFilters(new URLSearchParams())).toEqual({
      limit: 25, cursor: null, dateFrom: null, dateTo: null, batchId: null,
      status: null, currency: null, monetaryBasis: null,
    });
  });
  it("accepts bounded filters without authorizing them", () => {
    expect(parseTransactionListFilters(new URLSearchParams({
      limit: "100", cursor: "abc_12-X", date_from: "2024-02-29", date_to: "2026-10-23",
      batch_id: row.batch_id, status: "WARNING", currency: "MYR", monetary_basis: "debit_credit",
    }))).toMatchObject({ limit: 100, cursor: "abc_12-X", dateFrom: "2024-02-29",
      batchId: row.batch_id, status: "WARNING", currency: "MYR", monetaryBasis: "debit_credit" });
  });
  it.each([
    "limit=0", "limit=101", "limit=2.5", "limit=-1", "limit=01", "limit=1&limit=2",
    "foo=bar", "status=REJECTED", "status=VALID&status=WARNING", "batch_id=00017",
    "currency=myr", "currency=MYRR", "monetary_basis=unknown", "date_from=2026-02-29",
    "date_from=2026-13-01", "date_from=2026-01-02&date_to=2026-01-01",
    "cursor=%2Funsafe%3D", "cursor=", "cursor=" + "a".repeat(513),
  ])("rejects unsafe query: %s", query => {
    expect(() => parseTransactionListFilters(new URLSearchParams(query))).toThrow(InvalidTransactionContractError);
  });
});

describe("Phase 6A transaction response projection", () => {
  it("preserves money and leading-zero identifiers without leaking internal fields", () => {
    const projected = projectTransactionRow({ ...row,
      source_file: "confidential.csv", context: { raw: true },
      transformations: [{ secret: "value" }], original_value: "sensitive" });
    expect(projected.source_amount).toBe("9007199254740993.123456789");
    expect(projected.source_row_id).toBe("00017");
    expect(projected.reference).toBe("00042");
    expect(projected).not.toHaveProperty("source_file");
    expect(projected).not.toHaveProperty("context");
    expect(projected).not.toHaveProperty("transformations");
    expect(projected).not.toHaveProperty("original_value");
    expect(Object.isFrozen(projected)).toBe(true);
  });
  it("preserves null as unavailable", () => {
    const projected = projectTransactionRow({ ...row, currency: null, currency_basis: null });
    expect(projected.balance).toBeNull();
    expect(projected.debit).toBeNull();
    expect(projected.credit).toBeNull();
    expect(projected.derived_ledger_net).toBeNull();
    expect(projected.currency).toBeNull();
  });
  it("allows exact ledger amount and WARNING", () => {
    expect(projectTransactionRow({ ...row, monetary_basis: "debit_credit", source_amount: null,
      debit: "0.00", credit: "125.50", derived_ledger_net: "-125.50", ingestion_status: "WARNING",
    })).toMatchObject({ debit: "0.00", credit: "125.50", derived_ledger_net: "-125.50",
      ingestion_status: "WARNING" });
  });
  it.each([
    { ingestion_status: "REJECTED" }, { source_amount: 5 }, { source_amount: "NaN" },
    { source_amount: "Infinity" }, { canonical_date: "2026-02-30" },
    { canonical_date_basis: "POSTING_DATE" }, { currency_basis: null },
    { monetary_basis: "debit_credit" }, { source_amount: null },
    { transaction_date: "2026-01-01" }, { id: "00017" },
  ])("fails closed on invalid row: %o", changes => {
    expect(() => projectTransactionRow({ ...row, ...changes })).toThrow(InvalidTransactionContractError);
  });
  it("rejects missing inputs", () => {
    for (const input of [null, [], undefined, 1, {}]) {
      expect(() => projectTransactionRow(input)).toThrow(InvalidTransactionContractError);
    }
  });
});
