import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createBatchQueryService, type BatchQueryDependencies } from "../../lib/server/api/batch-query";
import { access, attemptId, batchA, batchB, harness, row } from "./batch.fixtures";

describe("internal batch query trust boundary", () => {
  it.each(["database", "resolveAccess", "audit", "cursors"] as const)("fails closed without %s", async key => {
    const { dependencies, mocks } = harness();
    const service = createBatchQueryService({ ...dependencies, [key]: undefined } as unknown as BatchQueryDependencies<unknown>);
    await expect(service.list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
    await expect(service.get(batchA, null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("fails closed without any dependencies", async () => {
    await expect(createBatchQueryService().list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
  });
  it.each(["verify", "issue"] as const)("fails closed with missing cursor %s", async method => {
    const { dependencies, mocks } = harness();
    const incomplete = { ...dependencies, cursors: { ...dependencies.cursors, [method]: undefined } } as unknown as BatchQueryDependencies<unknown>;
    await expect(createBatchQueryService(incomplete).list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it.each([null, { ...access, organizationId: "" }, { ...access, batchIds: ["bad"] }, { ...access, batchIds: undefined }])("denies absent/malformed scope %o", async grant => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue(grant as typeof access);
    await expect(createBatchQueryService(dependencies).list(new URLSearchParams(), { role: "admin", organizationId: "forged" })).rejects.toBeInstanceOf(Error);
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("does not authorize a lookup using the requested UUID", async () => {
    const { dependencies, mocks } = harness();
    expect(await createBatchQueryService(dependencies).get(batchB, null)).toBeNull();
    expect(mocks.database.query).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith({ subjectId: access.subjectId, organizationId: access.organizationId,
      operation: "lookup", outcome: "not_found", resultCount: 0 });
  });
  it("treats missing authorized records identically to unavailable scope", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await createBatchQueryService(dependencies).get(batchA, null)).toBeNull();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "not_found", resultCount: 0 }));
  });
  it("returns an audited empty scope without querying", async () => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue({ ...access, batchIds: [] });
    expect(await createBatchQueryService(dependencies).list(new URLSearchParams(), null)).toEqual({ items: [], nextCursor: null });
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("parameterizes scope, filters, verified cursor position and limit", async () => {
    const { dependencies, mocks } = harness();
    mocks.cursors.verify.mockResolvedValue({ createdAt: row.created_at, batchId: batchB });
    await createBatchQueryService(dependencies).list(new URLSearchParams({ limit: "1", status: "ACTIVE", persistence_attempt_id: attemptId, cursor: "synthetic" }), null);
    const [sql, values] = (mocks.database.query.mock.calls as unknown as [string, unknown[]][])[0];
    expect(values).toEqual([[batchA], "ACTIVE", attemptId, row.created_at, batchB, 2]);
    for (const value of [batchA, attemptId, row.created_at, batchB]) expect(sql).not.toContain(value);
    expect(sql).toContain("id = ANY($1::uuid[])"); expect(sql).toContain("(created_at, id) < ($4::timestamptz, $5::uuid)");
    expect(sql).toContain("r.id = i.financial_record_id"); expect(sql).toContain("r.batch_id = b.id");
    expect(sql).not.toContain("SELECT *"); expect(sql).not.toMatch(/i\.(message|original_value|rule|field|source_column)/);
    expect(sql).not.toMatch(/b\.(context|source_file|dataset_id)/);
  });
  it("parameterizes lookup IDs and requests a separately authorized operation", async () => {
    const { dependencies, mocks } = harness(); const context = Object.freeze({ session: "synthetic" });
    await createBatchQueryService(dependencies).get(batchA, context);
    expect(mocks.resolveAccess).toHaveBeenCalledExactlyOnceWith(context, "lookup");
    const [sql, values] = (mocks.database.query.mock.calls as unknown as [string, unknown[]][])[0];
    expect(values).toEqual([[batchA], batchA, 1]); expect(sql).toContain("id = $2::uuid"); expect(sql).not.toContain(batchA);
  });
  it("never reports a denied or failed request without attempted audit persistence", async () => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValue(null); mocks.audit.mockRejectedValue(new Error("sink down"));
    await expect(createBatchQueryService(dependencies).get(batchA, null)).rejects.toMatchObject({ code: "AUDIT_FAILED" });
    expect(mocks.database.query).not.toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it.each(["status=ACTIVE%27%20OR%201%3D1--", "persistence_attempt_id=bad", "organization_id=forged"])("rejects injection/unknown request %s", async query => {
    const { dependencies, mocks } = harness();
    await expect(createBatchQueryService(dependencies).list(new URLSearchParams(query), null)).rejects.toBeInstanceOf(Error);
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it.each([{ ...row, id: batchB }, { ...row, status: "unknown" }, { ...row, total_warning_issues: undefined }])("withholds malformed/unscoped database rows", async invalid => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [invalid] as typeof row[], rowCount: 1 });
    await expect(createBatchQueryService(dependencies).list(new URLSearchParams(), null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
  });
  it("validates hidden lookahead rows", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockResolvedValue({ rows: [row, { ...row, id: batchB }], rowCount: 2 });
    await expect(createBatchQueryService(dependencies).list(new URLSearchParams({ limit: "1" }), null)).rejects.toMatchObject({ code: "QUERY_FAILED" });
  });
  it("sanitizes and audits database errors without retrying", async () => {
    const { dependencies, mocks } = harness(); mocks.database.query.mockRejectedValue(new Error("secret SQL"));
    await expect(createBatchQueryService(dependencies).get(batchA, null)).rejects.toMatchObject({ code: "QUERY_FAILED", message: "Batch query could not be completed" });
    expect(mocks.database.query).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
  });
  it("audits resolver denial and sanitizes resolver exceptions", async () => {
    const { dependencies, mocks } = harness(); mocks.resolveAccess.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("secret token"));
    const service = createBatchQueryService(dependencies);
    await expect(service.get(batchA, null)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(mocks.audit).toHaveBeenLastCalledWith({ subjectId: null, organizationId: null, operation: "lookup", outcome: "denied", resultCount: 0 });
    await expect(service.get(batchA, null)).rejects.toMatchObject({ code: "SECURITY_UNAVAILABLE" });
  });
  it.each(["throw", "no-ack"])("withholds data on audit failure %s", async mode => {
    const { dependencies, mocks } = harness();
    if (mode === "throw") mocks.audit.mockRejectedValue(new Error("sink failed"));
    else mocks.audit.mockResolvedValue(undefined as unknown as true);
    await expect(createBatchQueryService(dependencies).get(batchA, null)).rejects.toMatchObject({ code: "AUDIT_FAILED" });
  });
  it("awaits audit acknowledgement before returning a page", async () => {
    const { dependencies, mocks } = harness(); let acknowledge!: (value: true) => void; let done = false;
    mocks.audit.mockImplementation(() => new Promise<true>(resolve => { acknowledge = resolve; }));
    const pending = createBatchQueryService(dependencies).list(new URLSearchParams(), null).then(value => { done = true; return value; });
    await vi.waitFor(() => expect(mocks.audit).toHaveBeenCalledOnce()); expect(done).toBe(false);
    acknowledge(true); expect((await pending).items).toHaveLength(1);
  });
  it.each([{ createdAt: "bad", batchId: batchA }, { createdAt: row.created_at, batchId: "bad" }])("rejects malformed verified positions", async anchor => {
    const { dependencies, mocks } = harness(); mocks.cursors.verify.mockResolvedValue(anchor);
    await expect(createBatchQueryService(dependencies).list(new URLSearchParams({ cursor: "synthetic" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(mocks.database.query).not.toHaveBeenCalled();
  });
  it("rejects forged tokens and invalid issuance and audits failures", async () => {
    const { dependencies, mocks } = harness(); const service = createBatchQueryService(dependencies);
    await expect(service.list(new URLSearchParams({ cursor: "forged" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(mocks.database.query).not.toHaveBeenCalled();
    mocks.database.query.mockResolvedValue({ rows: [row, row], rowCount: 2 }); mocks.cursors.issue.mockResolvedValue("invalid/token");
    await expect(service.list(new URLSearchParams({ limit: "1" }), null)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});
