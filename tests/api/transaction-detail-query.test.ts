import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { InvalidTransactionContractError, parseTransactionId } from "../../lib/server/api/transaction-contract";
import { createTransactionDetailQueryService, type TransactionDetailDependencies } from "../../lib/server/api/transaction-detail-query";
import { access, batchA, batchB, row } from "./transaction-query.fixtures";

function harness() {
  const mocks = { database: { query: vi.fn(async (): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => ({ rows: [row], rowCount: 1 })) },
    resolveAccess: vi.fn(async (): Promise<typeof access | null> => access), audit: vi.fn(async () => true as const) };
  return { mocks, dependencies: mocks as unknown as TransactionDetailDependencies<unknown> };
}
describe("internal transaction detail boundary", () => {
  it.each([null, undefined, {}, [], 1, "", "00017", row.id + "' OR true"])("rejects invalid UUID %o without querying", async value => {
    const { dependencies, mocks } = harness();
    await expect(createTransactionDetailQueryService(dependencies).get(value, null)).rejects.toBeInstanceOf(InvalidTransactionContractError);
    expect(mocks.resolveAccess).not.toHaveBeenCalled(); expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("accepts and normalizes UUID case without treating it as authority", () => {
    expect(parseTransactionId("ABCDEF00-0000-4000-8000-000000000001")).toBe("abcdef00-0000-4000-8000-000000000001");
  });
  it.each(["database", "resolveAccess", "audit"] as const)("fails closed without %s", async key => {
    const { dependencies, mocks } = harness();
    const missing = { ...dependencies, [key]: undefined } as unknown as TransactionDetailDependencies<unknown>;
    await expect(createTransactionDetailQueryService(missing).get(row.id, null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("cannot run without dependencies", async () => {
    await expect(createTransactionDetailQueryService().get(row.id, null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
  });
  it.each([null, { ...access, batchIds: ["bad"] }, { ...access, organizationId: "" }, { ...access, batchIds: undefined }])("fails closed on denied/malformed scope %o", async grant => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue(grant as typeof access);
    await expect(createTransactionDetailQueryService(dependencies).get(row.id, { role: "admin", organizationId: "forged" })).rejects.toBeInstanceOf(Error);
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("parameterizes UUID and trusted scope, reusing the exact minimal DTO", async () => {
    const { dependencies, mocks } = harness(); const context = Object.freeze({ session: "synthetic" });
    const item = await createTransactionDetailQueryService(dependencies).get(row.id, context);
    expect(mocks.resolveAccess).toHaveBeenCalledExactlyOnceWith(context, row.id);
    const [sql, values] = (mocks.database.query.mock.calls as unknown as [string, unknown[]][])[0];
    expect(values).toEqual([row.id, [batchA]]); expect(sql).not.toContain(row.id); expect(sql).not.toContain(batchA);
    expect(sql).toContain("r.id = $1::uuid AND r.batch_id = ANY($2::uuid[])");
    expect(sql).toContain("r.ingestion_status IN ('VALID', 'WARNING')"); expect(sql).not.toContain("SELECT *");
    expect(sql).not.toMatch(/r\.(source_file|transformations|context)/);
    expect(item).toMatchObject({ transaction_id: row.id, source_amount: row.source_amount, debit: null, balance: null, reference: "00042" });
    expect(Object.isFrozen(item)).toBe(true);
  });
  it.each(["VALID", "WARNING"])("allows accepted %s records", async ingestion_status => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [{ ...row, ingestion_status }], rowCount: 1 });
    expect(await createTransactionDetailQueryService(dependencies).get(row.id, null)).toMatchObject({ ingestion_status });
  });
  it.each(["-0", "-0.00"])("preserves supplied directed negative-zero text %s", async source_amount => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [{ ...row, source_amount,
      monetary_basis: "source_amount_with_direction", entry_side: "DEBIT" }], rowCount: 1 });
    expect(await createTransactionDetailQueryService(dependencies).get(row.id, null)).toMatchObject({ source_amount, entry_side: "DEBIT" });
  });
  it("returns audited null on no scoped row and performs no existence probe", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await createTransactionDetailQueryService(dependencies).get(row.id, null)).toBeNull();
    expect(mocks.database.query).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith({ subjectId: access.subjectId, organizationId: access.organizationId,
      transactionId: row.id, outcome: "not_found", recordCount: 0 });
  });
  it("returns audited null without querying an empty scope", async () => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [] });
    expect(await createTransactionDetailQueryService(dependencies).get(row.id, null)).toBeNull();
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "not_found" }));
  });
  it.each([{ ...row, id: batchB }, { ...row, batch_id: batchB }, { ...row, ingestion_status: "REJECTED" },
    { ...row, source_amount: 1 }, { ...row, posting_date: undefined }])("withholds invalid/mismatched/unscoped rows", async invalid => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [invalid] as typeof row[], rowCount: 1 });
    await expect(createTransactionDetailQueryService(dependencies).get(row.id, null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", recordCount: 0 }));
  });
  it("rejects multiple rows from a faulty adapter", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [row, row], rowCount: 2 });
    await expect(createTransactionDetailQueryService(dependencies).get(row.id, null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });
  it("sanitizes resolver and SQL errors without retrying", async () => {
    const { dependencies, mocks } = harness(); const service = createTransactionDetailQueryService(dependencies);
    mocks.resolveAccess.mockRejectedValueOnce(new Error("secret token"));
    await expect(service.get(row.id, null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE", message: "Transaction detail query could not be completed" });
    mocks.database.query.mockRejectedValue(new Error("secret SQL"));
    await expect(service.get(row.id, null)).rejects.toMatchObject({ code: "QUERY_FAILED", message: "Transaction detail query could not be completed" });
    expect(mocks.database.query).toHaveBeenCalledOnce();
  });
  it.each(["throw", "false", "undefined"])("withholds responses when audit does not acknowledge: %s", async mode => {
    const { dependencies, mocks } = harness();
    if (mode === "throw") mocks.audit.mockRejectedValue(new Error("secret sink error"));
    else mocks.audit.mockResolvedValue((mode === "false" ? false : undefined) as unknown as true);
    await expect(createTransactionDetailQueryService(dependencies).get(row.id, null)).rejects.toMatchObject({ code: "AUDIT_FAILED" });
  });
  it.each(["not_found", "denied", "failure"])("requires audit acknowledgement on %s", async outcome => {
    const { dependencies, mocks } = harness();
    if (outcome === "not_found") mocks.database.query.mockResolvedValue({ rows: [], rowCount: 0 });
    if (outcome === "denied") mocks.resolveAccess.mockResolvedValue(null);
    if (outcome === "failure") mocks.database.query.mockRejectedValue(new Error("synthetic"));
    mocks.audit.mockRejectedValue(new Error("synthetic audit unavailable"));
    await expect(createTransactionDetailQueryService(dependencies).get(row.id, null)).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome, recordCount: 0 }));
  });
  it("does not release a DTO before audit acknowledgement", async () => {
    const { dependencies, mocks } = harness(); let acknowledge!: (value: true) => void; let settled = false;
    mocks.audit.mockImplementation(() => new Promise<true>(resolve => { acknowledge = resolve; }));
    const pending = createTransactionDetailQueryService(dependencies).get(row.id, null).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(mocks.audit).toHaveBeenCalledOnce()); expect(settled).toBe(false);
    acknowledge(true); expect((await pending)!.transaction_id).toBe(row.id);
  });
});
