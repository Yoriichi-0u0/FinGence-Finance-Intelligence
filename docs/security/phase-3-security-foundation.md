# Phase 3 security foundation

## Scope

This is a local, unintegrated security foundation for the proposed backend/API boundary. It contains a server-only authorization policy and an allowlisted security-audit event constructor with unit tests. It does not change Phase 1 or Phase 2 database behavior, the ingestion contract, hosted Supabase, or any team member's ZIP file.

## Authorization

`lib/server/security/authorization.ts` checks one server-assigned role, exact resource type, and organization equality. Administrators can manage organization users/roles/settings and review security logs, but have no routine permission to read financial records or rejected evidence. Finance Analysts receive the proposed processing, record, evidence, and report permissions. Management/Reviewers receive read-only access only to server-confirmed approved dashboards and reports. Keeping one role in the principal avoids silently combining permissions; any need for multiple roles per user should be agreed and designed explicitly.

An exceptional administrator read requires a server-verified approval for one administrator, organization, action, and resource ID; the approver must be a different person, a non-empty reason must exist, and the approval must not be expired. The decision marks this access as requiring an audit event and returns the approval ID. The API must write that event before returning the sensitive data.

Every authorization decision—including a normal role-based allow—is marked as requiring an audit event so the eventual API cannot silently skip logging a protected action. The route should map the decision to the specific action name and target ID in the audit event.

The function expects an identity, organization membership, roles, resource, and approval resolved by trusted server components. Never construct these values from browser-supplied roles, organization IDs, resource IDs without a database lookup, or approval objects. A caller must authenticate the Supabase identity token first and load the user's active organization/role from the approved membership source.

## Audit events

`lib/server/security/audit.ts` creates an immutable record from a strict field allowlist. It records a server-generated timestamp, actor/organization identifiers, action, outcome, target identifiers, optional request ID, and optional approval reference. Unknown fields are rejected, so transaction amounts, descriptions, credentials, file content, and arbitrary error text cannot accidentally pass through as audit data.

The returned event still needs to be written to a protected audit sink with access restricted from ordinary application users. The approval reason should remain in the protected approval record; the audit event links to that record by `approvalId` rather than copying free text into logs.

## C3-B1 grouped persistence integration

The updated backend adds an internal grouped-persistence service. It writes one parent persistence attempt and its dataset-specific batches atomically, supports `COMPLETED_EMPTY`, and requires investigation rather than automatic retry after `COMMIT_OUTCOME_UNKNOWN` or `ROLLBACK_UNCONFIRMED`. This service is not an authenticated API and its `attempt_id` is a correlation identifier, not proof that a caller may access the attempt.

The current `persistence_attempts` table contains the attempt ID, dataset count, and creation time; it does not bind an attempt to an authenticated actor or organization. Its row-level security remains server-only, with ordinary client access revoked. That is suitable for the current internal persistence boundary, but it is not enough to authorize per-user or per-organization attempt creation, status reads, or investigation. Before exposing those operations through an API, the backend must add and verify trusted ownership/organization context or provide an equivalent server-side ownership mapping. The API must resolve that context from authenticated membership and stored state, never from caller-supplied IDs or role fields. Knowing an attempt UUID must not authorize `investigateAttempt`.

Grouped batch context includes source-file metadata, profile, mapping, options, producer context, sheet/header details, and columns. Treat it as sensitive operational/financial metadata; do not return it or include it in audit events by default. C3-B1 does not persist rejected raw rows, so it does not itself provide a rejected-evidence retrieval endpoint.

The policy prototype now defines separate `persistence_attempt.create` and `persistence_attempt.investigate` actions. Its proposed least-privilege rule permits the Finance Analyst who owns an attempt to create and investigate it; another user, Administrator, or Management/Reviewer is denied. This ownership rule is not usable until a trusted server-side owner and organization mapping exists. The API must derive the creator from the verified identity on create and load the stored owner/organization before investigation; never accept these values from the request body. This is a proposed role rule for team review, not yet an endpoint permission.

The audit helper now supports attempt creation and investigation events with target type `persistence_attempt`. Investigation events carry only the bounded outcomes `CONFIRMED_COMMITTED`, `CONFIRMED_NOT_COMMITTED`, or `UNRESOLVED`; they must not record exception text. Exclude filenames, dataset context, transaction contents, and raw database errors. Never retry automatically based on an uncertain result. Add route-level tests for unauthenticated access, wrong-organization/owner access, denied audit events, and each investigation outcome before enabling the endpoint.

## Not implemented yet

This code is not wired to a route handler or public API. It does not verify Supabase JWTs, create or revoke sessions, implement MFA, persist memberships/approvals/attempt ownership, write audit events to PostgreSQL, configure per-organization RLS, scan uploaded files, set storage retention, or rate-limit requests. The current C3-B1 schema has no actor/organization ownership for persistence attempts, so the new policy requires a reviewed additive schema change before route integration. These controls need a confirmed API/auth/storage design and integration with the backend owner before deployment. No hosted service or database was contacted.

## Local checks

Run the security tests with `pnpm exec vitest run tests/security`. Run the backend's normal `pnpm typecheck`, `pnpm lint`, and `pnpm test` before integration.
