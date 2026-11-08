import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { authorize, type ExceptionalAccessApproval, type ProtectedResource, type TrustedPrincipal } from "../../lib/server/security/authorization";

const resource: ProtectedResource = { organizationId: "org-a", type: "financial_record", id: "record-1" };
const principal = (role: TrustedPrincipal["role"], subjectId = "user-1"): TrustedPrincipal => ({
  subjectId, organizationId: "org-a", role,
});

describe("server authorization policy", () => {
  it("fails closed for missing, malformed, accessor-based, and unknown-role identities", () => {
    expect(authorize(null, "financial_record.read", resource).code).toBe("UNAUTHENTICATED");
    expect(authorize({ ...principal("finance_analyst"), role: "owner" }, "financial_record.read", resource).code).toBe("INVALID_CONTEXT");
    const getterPrincipal = Object.defineProperty({}, "subjectId", { get: () => "user-1" });
    expect(authorize(getterPrincipal, "financial_record.read", resource).code).toBe("INVALID_CONTEXT");
  });

  it("requires the server-resolved organization to match the target resource", () => {
    expect(authorize(principal("finance_analyst"), "financial_record.read", { ...resource, organizationId: "org-b" }))
      .toMatchObject({ allowed: false, code: "CROSS_ORGANIZATION", auditRequired: true });
  });

  it("grants the finance analyst their proposed upload, record, evidence, reconciliation, and report permissions", () => {
    const finance = principal("finance_analyst");
    const actions = [
      ["ingestion.upload", "ingestion_batch"],
      ["ingestion.process", "ingestion_batch"],
      ["financial_record.read", "financial_record"],
      ["financial_record.reconcile", "financial_record"],
      ["rejected_evidence.read", "rejected_evidence"],
      ["report.generate", "report"],
      ["report.read", "report"],
      ["report.download", "report"],
    ] as const;
    for (const [action, type] of actions) {
      expect(authorize(finance, action, {
        organizationId: "org-a", type, id: "resource-1", ...(type === "report" ? { approvalStatus: "draft" } : {}),
      }))
        .toMatchObject({ allowed: true, code: "ROLE_PERMISSION", auditRequired: true });
    }
  });

  it("keeps reviewer access read-only and excludes raw records and rejected evidence", () => {
    const reviewer = principal("management_reviewer");
    expect(authorize(reviewer, "dashboard.read", { organizationId: "org-a", type: "dashboard", id: "dashboard-1", approvalStatus: "approved" }).allowed).toBe(true);
    expect(authorize(reviewer, "report.read", { organizationId: "org-a", type: "report", id: "report-1", approvalStatus: "approved" }).allowed).toBe(true);
    expect(authorize(reviewer, "dashboard.read", { organizationId: "org-a", type: "dashboard", id: "dashboard-2", approvalStatus: "draft" }).allowed).toBe(false);
    expect(authorize(reviewer, "report.read", { organizationId: "org-a", type: "report", id: "report-2", approvalStatus: "draft" }).allowed).toBe(false);
    expect(authorize(reviewer, "report.generate", { organizationId: "org-a", type: "report", id: "report-1", approvalStatus: "approved" }).allowed).toBe(false);
    expect(authorize(reviewer, "financial_record.read", resource).allowed).toBe(false);
    expect(authorize(reviewer, "rejected_evidence.read", { ...resource, type: "rejected_evidence" }).allowed).toBe(false);
  });

  it("does not give administrators routine access to raw records or rejected evidence", () => {
    expect(authorize(principal("administrator"), "financial_record.read", resource))
      .toMatchObject({ allowed: false, code: "ROLE_DENIED", auditRequired: true });
    expect(authorize(principal("administrator"), "rejected_evidence.read", { ...resource, type: "rejected_evidence" }).allowed).toBe(false);
    expect(authorize(principal("administrator"), "organization_roles.manage", {
      organizationId: "org-a", type: "organization_user", id: "user-2",
    }).allowed).toBe(true);
  });

  it("limits grouped persistence creation and investigation to the finance analyst who owns the attempt", () => {
    const attempt = {
      organizationId: "org-a", type: "persistence_attempt", id: "attempt-1", ownerSubjectId: "user-1",
    } as const;
    const finance = principal("finance_analyst");
    expect(authorize(finance, "persistence_attempt.create", attempt))
      .toMatchObject({ allowed: true, code: "ROLE_PERMISSION", auditRequired: true });
    expect(authorize(finance, "persistence_attempt.investigate", attempt))
      .toMatchObject({ allowed: true, code: "ROLE_PERMISSION", auditRequired: true });
    expect(authorize(principal("finance_analyst", "user-2"), "persistence_attempt.investigate", attempt))
      .toMatchObject({ allowed: false, code: "RESOURCE_OWNER_MISMATCH", auditRequired: true });
    expect(authorize(principal("administrator"), "persistence_attempt.investigate", attempt))
      .toMatchObject({ allowed: false, code: "ROLE_DENIED", auditRequired: true });
    expect(authorize(finance, "persistence_attempt.investigate", {
      organizationId: "org-a", type: "persistence_attempt", id: "attempt-1",
    }).code).toBe("INVALID_CONTEXT");
  });

  it("allows an administrator exception only for an independently approved, unexpired, exact-resource grant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00.000Z"));
    const approval: ExceptionalAccessApproval = {
      approvalId: "approval-1", subjectId: "admin-1", approvedBySubjectId: "admin-2",
      organizationId: "org-a", action: "financial_record.read", resourceType: "financial_record",
      resourceId: "record-1", reason: "Investigate an approved support incident", expiresAt: "2026-10-12T00:15:00.000Z",
    };
    expect(authorize(principal("administrator", "admin-1"), "financial_record.read", resource, approval))
      .toEqual({ allowed: true, code: "APPROVED_ADMIN_EXCEPTION", auditRequired: true, approvalId: "approval-1" });
    expect(authorize(principal("administrator", "admin-1"), "financial_record.read", { ...resource, id: "record-2" }, approval).allowed).toBe(false);
    expect(authorize(principal("administrator", "admin-1"), "financial_record.read", resource, { ...approval, approvedBySubjectId: "admin-1" }).allowed).toBe(false);
    expect(authorize(principal("administrator", "admin-1"), "financial_record.read", resource, { ...approval, expiresAt: "2026-10-11T23:59:59.000Z" }).allowed).toBe(false);
    vi.useRealTimers();
  });

  it("rejects an action/resource mismatch and caller-injected principal fields", () => {
    expect(authorize(principal("finance_analyst"), "financial_record.read", { organizationId: "org-a", type: "report", id: "report-1", approvalStatus: "draft" }).code)
      .toBe("RESOURCE_ACTION_MISMATCH");
    expect(authorize({ ...principal("finance_analyst"), isAdmin: true }, "financial_record.read", resource).code)
      .toBe("INVALID_CONTEXT");
  });
});
