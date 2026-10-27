import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SqlConnection, TransactionDatabase } from "../../lib/server/db/postgres";
import { createTransactionSecurityGuard } from "../../lib/server/security/transaction-guard";
import type { TrustedPrincipal } from "../../lib/server/security/authorization";

const principal: TrustedPrincipal = { subjectId: "user-a", organizationId: "org-a", role: "finance_analyst" };
const batch = "10000000-0000-4000-8000-000000000001";
const record = "20000000-0000-4000-8000-000000000001";
const access = { subjectId: "user-a", organizationId: "org-a", scopeVersion: "v1", batchIds: [batch] };
const request = new Request("http://127.0.0.1/");

function fixture() {
  const captured: unknown[][] = [];
  const connection: SqlConnection = { async query(_sql, values) { captured.push(values ?? []); return { rows: [], rowCount: 1 }; } };
  const database: TransactionDatabase = { transaction: async work => work(connection), close: async () => {} };
  const dependencies = { database, resolvePrincipal: vi.fn(async (): Promise<TrustedPrincipal | null> => principal),
    resolveAccess: vi.fn(async () => access), resolveTransactionScope: vi.fn(async () => ({ batchId: batch,
      resource: { organizationId: "org-a", type: "financial_record" as const, id: record } })) };
  return { dependencies, captured, guard: createTransactionSecurityGuard(dependencies) };
}

describe("Jason's server authorization guard", () => {
  it("requires matching trusted identity, membership scope and record authorization", async () => {
    const f = fixture();
    expect((await f.guard.authorizeRequest(request, "transaction.read", record)).principal).toEqual(principal);
    expect(f.captured).toHaveLength(0); // The query adapter must persist the success audit.
    f.dependencies.resolveAccess.mockResolvedValueOnce({ ...access, organizationId: "org-b" });
    await expect(f.guard.authorizeRequest(request, "transaction.read", record)).rejects.toMatchObject({ status: 404 });
    expect(f.captured).toHaveLength(1);
  });

  it("audits missing identity and resolver failures without leaking raw errors", async () => {
    const f = fixture();
    f.dependencies.resolvePrincipal.mockResolvedValueOnce(null);
    await expect(f.guard.authorizeRequest(request, "transactions.list")).rejects.toMatchObject({ status: 401 });
    f.dependencies.resolveAccess.mockRejectedValueOnce(new Error("private diagnostic"));
    await expect(f.guard.authorizeRequest(request, "transactions.list")).rejects.toMatchObject({ status: 503 });
    expect(f.captured).toHaveLength(2);
    expect(JSON.stringify(f.captured)).not.toContain("private diagnostic");
  });

  it("never treats a failed denial-audit transaction as permission to continue", async () => {
    const f = fixture();
    f.dependencies.resolvePrincipal.mockResolvedValueOnce(null);
    f.dependencies.database.transaction = async () => { throw new Error("synthetic audit failure"); };
    await expect(f.guard.authorizeRequest(request, "transactions.list")).rejects.toThrow("synthetic audit failure");
  });
});
