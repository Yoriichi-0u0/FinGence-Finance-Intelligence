# AI06 role views and owner-only security hardening

Status: **PARTIAL / BLOCKED FOR MERGE AND PRODUCTION**. Base main `85512bb4ed3d0d095059b0060c709fd9725586bf`. Prepared 16 November 2026. No hosted database, provider, environment, deployment or credential operations.

## Implemented

- The saved website GPT evidence API projects FINANCE responses on the server using an explicit allowlist. Processing IDs, hashes, evidence IDs, model/prompt versions and raw verifier JSON are absent. Suggestions, references, explanations, abstentions, timestamps and UNRESOLVED outcomes remain.
- PASS requires all four independent checks to be true under the existing website-pair-verifier/1 policy. A failed check produces FAIL; missing/unknown evidence produces UNAVAILABLE; abstentions are NOT_APPLICABLE. Scores remain null. The persisted full evidence is unchanged.
- ADMIN and SUPERADMIN receive technical evidence only through the existing organization/member/job-bound audited read. Neither gets cross-user financial access.
- History rejects scope=all for every role. Open, document download and delete require a token-bound database ownership contract. Finance history listings omit processing IDs. The job status API checks the same contract before reading a job. Missing contracts return safe 503 responses, never an organization-wide fallback.
- History UI lists own runs only. The technical log switches to a distinct owner-scoped RPC so old deployments fail closed.
- Existing upload processing, independent reconciliation rechecking, post-commit GPT hook, gateway/key3, budgets, pilot controls, duplicate prevention, immutable storage, audit and bounded automatic UI polling are preserved. No activation flags are changed.

## Existing role permissions reused

| Action | FINANCE | ADMIN | SUPERADMIN |
| --- | --- | --- | --- |
| Upload/process own jobs; own saved GPT suggestions | Yes, subject to existing pause/AI/pilot/budget gates | Yes | Yes |
| Raw GPT technical evidence for own jobs | No | Yes | Yes |
| Another member's financial results/documents/GPT evidence | No | No | No |
| Manage FINANCE users / processing controls | No | Yes | Yes |
| Manage ADMIN users / AI control / administrative audit | No | No | Yes |

The existing authoritative role checks and lower-rank management rules are reused. Organization-level operational counters and metadata-only AI-call logs remain administrative information; financial run/document details in technical logs are restricted to their submitter.

## Review-only database prerequisite

`supabase/sql/ai06-owner-only-rbac-review.sql` is new, atomic SQL; existing migrations and deployed AI06/DB04 SQL are untouched. SHA256: `0bd49156fa45b2aba68e8a62592be61024204a2f38bbeef5f1d8a5a22593684c`.

It replaces history, saved-run opening and deletion functions to remove the ADMIN/SUPERADMIN ownership bypass, and restricts technical-log financial run/failed-job details to the actor. It adds `fingence_workspace_owns_resource(text,text,uuid)` and `fingence_workspace_own_log(text,timestamptz)`. New functions have an empty search_path, SECURITY DEFINER, no PUBLIC/anon/authenticated execution, and execution only through the existing workspace service transport. No new table permissions, runtime memberships, tables, financial updates or privileged credential fallbacks are introduced. Existing function ACLs are retained by CREATE OR REPLACE.

This SQL is **not deployed**. The new application must not be merged/deployed ahead of the approved database contract: job status, saved-run reopening/download/deletion and technical logs otherwise fail closed. Owner approval and a separately verified controlled database rollout are required. Do not reinstall previous migrations. Do not weaken the dedicated AI06 evidence login.

Review current function definitions/ACLs against main before any future execution. Review locks and dependency resolution in a read-only catalog session first. Deploy the whole reviewed transaction once, verify ACLs and own/cross-user behavior using synthetic accounts, then deploy the application. A failure rolls back the transaction; an uncertain commit must be inspected, never retried automatically. Prefer a forward fix: restoring the previous functions restores cross-user access and is not a safe security rollback.

## Remaining implementation blocker (not an owner permission handoff)

**The complete requested FINANCE API redaction is not implemented.** Existing saved-run reopening and processing status APIs still return technical restore/recheck bundles (processing IDs, input fingerprints, accepted layout interpretations and extraction data). The existing browser uses these to independently reproduce deterministic reconciliation and verify the processing anchor. Removing them would break existing results/reopening or weaken verification.

A separate server-verified financial-results projection and corresponding client recheck contract must be implemented and tested before claiming the complete RBAC task is done. No bypass, synthetic substitute or silent omission was introduced. This is remaining application work, not a claim that another teammate must grant broader access. Keep the PR draft and do not merge/activate on the strength of GPT-only redaction.

## Validation

152 distinct final passing tests: 114 workspace/processing/role-view/polling regression tests, 13 GPT generation/persistence tests with mocked providers, and 25 native PostgreSQL 18.6 tests on the explicitly verified disposable loopback cluster. Zero final failures or skips in those executed selections. The 11 affected history tests were rerun successfully after listing redaction; not counted again.

Initial filesystem test failures were sandbox EPERM on atomic hard links; the affected 13 tests passed outside the sandbox. Three initial new native fixtures omitted the required START admission audit; fixtures were corrected (no security rule change) and all 25 passed. Native coverage includes all role projections using actual sessions, restricted login, tenant/job ownership, forced RLS, immutable evidence, duplicate/concurrent attempts, atomic audit failure rollback and reconnection. No live provider or Production test was executed.

TypeScript, changed-file ESLint, server import boundary and Production build results are recorded in the PR. Build uses a temporary local Turbopack root override for the Windows dependency junction, restored byte-for-byte; all processing/AI flags disabled during build. Do not count this as hosted verification.
