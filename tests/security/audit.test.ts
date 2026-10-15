import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSecurityAuditEvent, InvalidSecurityAuditEvent } from "../../lib/server/security/audit";

describe("security audit event construction", () => {
  it("creates a timestamped event containing identifiers and action metadata only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T01:02:03.000Z"));
    const event = createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "rejected_evidence.read", outcome: "success",
      targetType: "rejected_evidence", targetId: "evidence-1", requestId: "req-1", approvalId: null,
    });
    expect(event).toEqual({
      occurredAt: "2026-10-12T01:02:03.000Z", actorId: "user-1", organizationId: "org-1",
      action: "rejected_evidence.read", outcome: "success", targetType: "rejected_evidence",
      targetId: "evidence-1", requestId: "req-1", approvalId: null,
    });
    expect(Object.isFrozen(event)).toBe(true);
    vi.useRealTimers();
  });

  it("rejects transaction contents, secrets, and other non-allowlisted fields", () => {
    expect(() => createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "financial_record.read", outcome: "success",
      targetType: "financial_record", targetId: "record-1", amount: "987.65", description: "private transaction",
    })).toThrow(InvalidSecurityAuditEvent);
    expect(() => createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "auth.sign_in_failed", outcome: "failure",
      targetType: null, targetId: null, password: "not-logged",
    })).toThrow(InvalidSecurityAuditEvent);
  });

  it("rejects invalid actions, outcomes, identifiers, and malformed target pairs", () => {
    const base = {
      actorId: "user-1", organizationId: "org-1", action: "auth.sign_in", outcome: "success",
      targetType: null, targetId: null,
    };
    expect(() => createSecurityAuditEvent({ ...base, action: "raw SQL" })).toThrow(InvalidSecurityAuditEvent);
    expect(() => createSecurityAuditEvent({ ...base, outcome: "maybe" })).toThrow(InvalidSecurityAuditEvent);
    expect(() => createSecurityAuditEvent({ ...base, actorId: "user-1\npassword=secret" })).toThrow(InvalidSecurityAuditEvent);
    expect(() => createSecurityAuditEvent({ ...base, targetType: "report" })).toThrow(InvalidSecurityAuditEvent);
  });

  it("records only the bounded outcome of a grouped persistence investigation", () => {
    const event = createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "persistence_attempt.investigated", outcome: "success",
      targetType: "persistence_attempt", targetId: "attempt-1", requestId: "req-2", approvalId: null,
      attemptOutcome: "UNRESOLVED",
    });
    expect(event).toMatchObject({
      action: "persistence_attempt.investigated", targetType: "persistence_attempt",
      targetId: "attempt-1", attemptOutcome: "UNRESOLVED",
    });
    expect(() => createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "persistence_attempt.investigated", outcome: "success",
      targetType: "persistence_attempt", targetId: "attempt-1", requestId: "req-2", approvalId: null,
      attemptOutcome: "raw database exception",
    })).toThrow(InvalidSecurityAuditEvent);
    expect(() => createSecurityAuditEvent({
      actorId: "user-1", organizationId: "org-1", action: "financial_record.read", outcome: "success",
      targetType: "financial_record", targetId: "record-1", requestId: "req-2", approvalId: null,
      attemptOutcome: "UNRESOLVED",
    })).toThrow(InvalidSecurityAuditEvent);
  });
});
