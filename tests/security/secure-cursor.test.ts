import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createBatchCursorAdapter, createTransactionCursorAdapter } from "../../lib/server/integration/query-cursors";
import { signTransactionCursor } from "../../lib/server/security/secure-cursor";
import type { TransactionCursorBinding } from "../../lib/server/api/transaction-query";
import type { BatchCursorBinding } from "../../lib/server/api/batch-query";
import type { TrustedPrincipal } from "../../lib/server/security/authorization";

const secret = "synthetic-test-signing-secret-32-bytes-minimum";
const principal: TrustedPrincipal = { subjectId: "analyst-a", organizationId: "org-a", role: "finance_analyst" };
const access = { subjectId: "analyst-a", organizationId: "org-a", scopeVersion: "v1", batchIds: ["10000000-0000-4000-8000-000000000001"] };
const filters = { limit: 1, dateFrom: null, dateTo: null, batchId: null, status: null, currency: null, monetaryBasis: null };
const binding: TransactionCursorBinding = { access, filters };
const position = { canonicalDate: "2026-09-03", transactionId: "20000000-0000-4000-8000-000000000001" };

describe("signed cursor compatibility", () => {
  it("round trips an actual HMAC token as canonical base64url within the query limit", async () => {
    const adapter = createTransactionCursorAdapter(principal, secret);
    const token = await adapter.issue(position, binding);
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    expect(Buffer.from(token, "base64url").toString("base64url")).toBe(token);
    expect(Buffer.from(token, "base64url").toString()).toContain(".");
    expect(await adapter.verify(token, binding)).toEqual(position);
  });

  it.each(["subject", "organization", "role", "scope", "batches", "filters", "limit"])("rejects replay when %s changes", async change => {
    const adapter = createTransactionCursorAdapter(principal, secret);
    const token = await adapter.issue(position, binding);
    const changedPrincipal = { ...principal, ...(change === "subject" ? { subjectId: "other" } : {}),
      ...(change === "organization" ? { organizationId: "other" } : {}),
      ...(change === "role" ? { role: "administrator" as const } : {}) };
    const changedAccess = { ...access, subjectId: changedPrincipal.subjectId, organizationId: changedPrincipal.organizationId,
      ...(change === "scope" ? { scopeVersion: "v2" } : {}),
      ...(change === "batches" ? { batchIds: [] } : {}) };
    const changedFilters = { ...filters, ...(change === "filters" ? { currency: "MYR" } : {}), ...(change === "limit" ? { limit: 2 } : {}) };
    await expect(createTransactionCursorAdapter(changedPrincipal, secret).verify(token, { access: changedAccess, filters: changedFilters })).rejects.toThrow();
  });

  it("rejects tampering, noncanonical wrappers, excessive input and expired signatures", async () => {
    const adapter = createTransactionCursorAdapter(principal, secret);
    const token = await adapter.issue(position, binding);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    for (const bad of [tampered, token + "=", "_", "A".repeat(513)]) await expect(adapter.verify(bad, binding)).rejects.toThrow();
    const signed = signTransactionCursor(JSON.stringify([position.canonicalDate, position.transactionId]), {
      principal, access, filters: { ...filters, collection: "transactions" }, pageLimit: 1,
    }, secret, { now: 1, ttlSeconds: 1 });
    await expect(adapter.verify(Buffer.from(signed).toString("base64url"), binding)).rejects.toThrow();
  });

  it("rejects a correctly signed malformed position and collection replay", async () => {
    const signed = signTransactionCursor(JSON.stringify(["not-a-date", position.transactionId]), {
      principal, access, filters: { ...filters, collection: "transactions" }, pageLimit: 1,
    }, secret);
    const adapter = createTransactionCursorAdapter(principal, secret);
    await expect(adapter.verify(Buffer.from(signed).toString("base64url"), binding)).rejects.toThrow();
    const token = await adapter.issue(position, binding);
    const batchBinding: BatchCursorBinding = { collection: "ingestion_batches", access, filters: { limit: 1, status: null, persistenceAttemptId: null } };
    await expect(createBatchCursorAdapter(principal, secret).verify(token, batchBinding)).rejects.toThrow();
  });

  it("round trips a batch cursor without weakening its collection or timestamp contract", async () => {
    const batchBinding: BatchCursorBinding = { collection: "ingestion_batches", access, filters: { limit: 1, status: null, persistenceAttemptId: null } };
    const adapter = createBatchCursorAdapter(principal, secret);
    const batchPosition = { createdAt: "2026-10-15T12:00:00.123456Z", batchId: access.batchIds[0] };
    const token = await adapter.issue(batchPosition, batchBinding);
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    expect(await adapter.verify(token, batchBinding)).toEqual(batchPosition);
    await expect(adapter.verify(token, { ...batchBinding, filters: { ...batchBinding.filters, status: "ACTIVE" } })).rejects.toThrow();
  });
});
