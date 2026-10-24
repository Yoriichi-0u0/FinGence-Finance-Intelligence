import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createTransactionQueryService, type TransactionQueryDependencies } from "../../lib/server/api/transaction-query";
import { access, batchA, batchB, harness, row } from "./transaction-query.fixtures";

describe("internal transaction query trust boundary", () => {
  it.each(["database", "resolveAccess", "cursors", "auditRead"] as const)("fails closed without %s", key => {
    const { dependencies, mocks } = harness();
    const missing = { ...dependencies, [key]: undefined } as unknown as TransactionQueryDependencies<unknown>;
    return expect(createTransactionQueryService(missing).list(new URLSearchParams(), {}))
      .rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" }).then(() => expect(mocks.database.query).not.toHaveBeenCalled());
  });
  it("cannot run without dependencies", async () => {
    await expect(createTransactionQueryService().list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
  });
  it.each([null, { ...access, batchIds: undefined }, { ...access, batchIds: ["not-a-uuid"] },
    { ...access, organizationId: "" }])("denies missing or malformed trusted access: %o", async grant => {
    const { dependencies, mocks } = harness();
    mocks.resolveAccess.mockResolvedValue(grant as typeof access);
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(), { role: "administrator", organizationId: "forged" })).rejects.toBeInstanceOf(Error);
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("passes context only to the trusted resolver and sanitizes resolver failures", async () => {
    const { dependencies, mocks } = harness(); const context = Object.freeze({ session: "synthetic-only" });
    mocks.resolveAccess.mockRejectedValue(new Error("secret token"));
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(), context)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE", message: "Transaction query could not be completed" });
    expect(mocks.resolveAccess).toHaveBeenCalledExactlyOnceWith(context);
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("does not treat a batch filter as authorization", async () => {
    const { dependencies, mocks } = harness();
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ batch_id: batchB }), null)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("returns an audited empty page without querying when the authorized scope is empty", async () => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [] });
    expect(await createTransactionQueryService(dependencies).list(new URLSearchParams(), null)).toEqual({ items: [], nextCursor: null });
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.auditRead).toHaveBeenCalledOnce();
  });
  it("parameterizes every filter, bounds the page and explicitly selects exact text values", async () => {
    const { dependencies, mocks } = harness();
    await createTransactionQueryService(dependencies).list(new URLSearchParams({ limit: "1", date_from: "2026-09-01",
      date_to: "2026-09-04", batch_id: batchA, status: "VALID", currency: "MYR", monetary_basis: "source_signed_amount" }), null);
    const [sql, values] = (mocks.database.query.mock.calls as unknown as [string, unknown[]][])[0];
    expect(values).toEqual([[batchA], "2026-09-01", "2026-09-04", batchA, "VALID", "MYR", "source_signed_amount", 2]);
    for (const value of [batchA, "2026-09-01", "MYR", "source_signed_amount"]) expect(sql).not.toContain(value);
    expect(sql).toContain("r.batch_id = ANY($1::uuid[])");
    expect(sql).toContain("r.ingestion_status IN ('VALID', 'WARNING')");
    expect(sql).toContain("r.source_amount::text AS source_amount");
    for (const column of ["canonical_date", "transaction_date", "posting_date"]) {
      expect(sql).toContain(`to_char(r.${column}, 'YYYY-MM-DD') AS ${column}`);
    }
    expect(sql).toContain("r.canonical_date >= $2::date"); expect(sql).toContain("r.canonical_date <= $3::date");
    expect(sql).not.toContain("SELECT *"); expect(sql).toContain("ORDER BY r.canonical_date DESC, r.id DESC");
  });
  it.each(["currency=MYR%27%20OR%201%3D1--", "batch_id=bad", "limit=999", "organization_id=forged", "status=REJECTED"])("rejects unsafe input %s before querying", async query => {
    const { dependencies, mocks } = harness();
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(query), null)).rejects.toBeInstanceOf(Error);
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it.each([{ ...row, ingestion_status: "REJECTED" }, { ...row, batch_id: batchB }, { ...row, source_amount: 1 }])("fails closed on corrupt database output", async invalid => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [invalid] as typeof row[], rowCount: 1 });
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
    expect(mocks.auditRead).not.toHaveBeenCalled();
  });
  it("sanitizes database failures without retrying", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockRejectedValue(new Error("sensitive SQL"));
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "QUERY_FAILED", message: "Transaction query could not be completed" });
    expect(mocks.database.query).toHaveBeenCalledOnce();
  });
  it.each(["throw", "no-ack"])("withholds data on audit failure: %s", async mode => {
    const { dependencies, mocks } = harness();
    if (mode === "throw") mocks.auditRead.mockRejectedValue(new Error("sink unavailable"));
    else mocks.auditRead.mockResolvedValue(undefined as unknown as true);
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "AUDIT_FAILED" });
  });
  it("awaits durable audit acknowledgement and supplies only minimal metadata", async () => {
    const { dependencies, mocks } = harness(); let acknowledge!: (value: true) => void;
    mocks.auditRead.mockImplementation(() => new Promise<true>(resolve => { acknowledge = resolve; }));
    let settled = false; const result = createTransactionQueryService(dependencies).list(new URLSearchParams(), null).then(page => { settled = true; return page; });
    await vi.waitFor(() => expect(mocks.auditRead).toHaveBeenCalledOnce()); expect(settled).toBe(false);
    expect(mocks.auditRead).toHaveBeenCalledWith({ subjectId: access.subjectId, organizationId: access.organizationId, recordCount: 1 });
    acknowledge(true); expect((await result).items[0].source_amount).toBe(row.source_amount);
  });
  it("rejects unverified cursors before querying", async () => {
    const { dependencies, mocks } = harness();
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ cursor: "forged" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it.each([{ canonicalDate: "2026-02-30", transactionId: row.id }, { canonicalDate: row.canonical_date, transactionId: "bad" }])("validates verified cursor positions defensively", async position => {
    const { dependencies, mocks } = harness(); mocks.cursors.verify.mockResolvedValue(position);
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ cursor: "synthetic" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("withholds the page when cursor issuance fails", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [row, row], rowCount: 2 });
    mocks.cursors.issue.mockRejectedValue(new Error("unavailable"));
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ limit: "1" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("validates the hidden lookahead row before returning any data", async () => {
    const { dependencies, mocks } = harness();
    mocks.database.query.mockResolvedValue({ rows: [row, { ...row, ingestion_status: "REJECTED" }], rowCount: 2 });
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ limit: "1" }), null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
    expect(mocks.cursors.issue).not.toHaveBeenCalled(); expect(mocks.auditRead).not.toHaveBeenCalled();
  });
  it("rejects invalid issued tokens rather than exposing unusable pagination", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [row, row], rowCount: 2 });
    mocks.cursors.issue.mockResolvedValue("invalid/token");
    await expect(createTransactionQueryService(dependencies).list(new URLSearchParams({ limit: "1" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});
