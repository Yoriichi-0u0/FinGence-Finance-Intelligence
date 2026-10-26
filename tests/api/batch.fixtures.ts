import { vi } from "vitest";
import type { BatchAccess, BatchCursorBinding, BatchPosition, BatchQueryDependencies } from "../../lib/server/api/batch-query";
export const batchA = "30000000-0000-4000-8000-000000000001";
export const batchB = "30000000-0000-4000-8000-000000000002";
export const attemptId = "40000000-0000-4000-8000-000000000001";
export const access: BatchAccess = { subjectId: "synthetic-analyst", organizationId: "synthetic-org", scopeVersion: "v1", batchIds: [batchA] };
export const row = { id: batchA, ingestion_batch_id: "synthetic-producer", persistence_attempt_id: null,
  status: "ACTIVE", created_at: "2026-09-01T00:00:00.123456Z", completed_at: "2026-09-01T01:00:00.123456Z",
  rows_received: 5, valid_count: 2, warning_count: 1, rejected_count: 2,
  total_warning_issues: "2", technical_warning_issues: "1", business_warning_issues: "1" };
/** Test-only cursor registry; never production authentication or cursor security. */
export function harness() {
  const saved = new Map<string, { position: BatchPosition; binding: string }>();
  const mocks = {
    database: { query: vi.fn(async () => ({ rows: [row], rowCount: 1 })) },
    resolveAccess: vi.fn(async (): Promise<BatchAccess | null> => access),
    audit: vi.fn(async () => true as const),
    cursors: {
      issue: vi.fn(async (position: BatchPosition, binding: BatchCursorBinding) => {
        const token = `synthetic_batch_${saved.size}`;
        saved.set(token, { position, binding: JSON.stringify(binding) }); return token;
      }),
      verify: vi.fn(async (token: string, binding: BatchCursorBinding) => {
        const entry = saved.get(token);
        if (!entry || entry.binding !== JSON.stringify(binding)) throw new Error("Invalid synthetic cursor");
        return entry.position;
      }),
    },
  };
  return { mocks, dependencies: mocks as unknown as BatchQueryDependencies<unknown> };
}
