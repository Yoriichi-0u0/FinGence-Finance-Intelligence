import { vi } from "vitest";
import type { TransactionAccess, TransactionCursorBinding, TransactionPosition, TransactionQueryDependencies } from "../../lib/server/api/transaction-query";
export const batchA = "10000000-0000-4000-8000-000000000001";
export const batchB = "10000000-0000-4000-8000-000000000002";
export const access: TransactionAccess = { subjectId: "synthetic-analyst", organizationId: "synthetic-org",
  scopeVersion: "v1", batchIds: [batchA] };
export const row = {
  id: "20000000-0000-4000-8000-000000000001", batch_id: batchA,
  ingestion_batch_id: "synthetic-producer", source_row_id: "00017",
  canonical_date: "2026-09-03", transaction_date: "2026-09-03", posting_date: "2026-09-04",
  canonical_date_basis: "TRANSACTION_DATE", reference: "00042", source_transaction_id: "00003",
  description: "Synthetic only", account_code: "00100", monetary_basis: "source_signed_amount",
  debit: null, credit: null, source_amount: "9007199254740993.123456789", entry_side: null,
  derived_ledger_net: null, balance: null, currency: "MYR", currency_basis: "SOURCE", ingestion_status: "VALID",
};
/** Test-only opaque registry. Not a production signature/identity implementation. */
export function harness() {
  const registry = new Map<string, { position: TransactionPosition; binding: string }>();
  const dependencies = {
    database: { query: vi.fn(async () => ({ rows: [row], rowCount: 1 })) },
    resolveAccess: vi.fn(async (): Promise<TransactionAccess | null> => access),
    auditRead: vi.fn(async () => true as const),
    cursors: {
      issue: vi.fn(async (position: TransactionPosition, binding: TransactionCursorBinding) => {
        const token = `synthetic_${registry.size}`;
        registry.set(token, { position, binding: JSON.stringify(binding) }); return token;
      }),
      verify: vi.fn(async (token: string, binding: TransactionCursorBinding) => {
        const saved = registry.get(token);
        if (!saved || saved.binding !== JSON.stringify(binding)) throw new Error("untrusted synthetic cursor");
        return saved.position;
      }),
    },
  };
  // SqlConnection is generic over result shape; this synthetic stub intentionally returns fixed rows.
  return { dependencies: dependencies as unknown as TransactionQueryDependencies<unknown>, mocks: dependencies };
}
