# DB04 immutable GPT evidence persistence — review only

Prepared 12 November 2026 on `feature/ai06-gpt-integration-celester`.
This follows [the GPT integration review](db04-ai06-gpt.md). No SQL has been executed.

## Proposed scope and files

- `supabase/sql/db04-005-gpt-evidence-review.sql`: additive, transactional migration; two new tables and two new trigger functions (completion triggers on both tables, reused immutable triggers on both, audit trigger on runs). Existing tables, policies, decisions and migration files are unchanged.
- `lib/server/reconciliation/gpt-persistence.ts`: opt-in, server-only persistence and protected read service. Reuses the DB04 principal and scoped transaction reader, re-parses proposal JSON, recomputes independent verification, rejects changed snapshots and tenant substitutions, allowlists persisted fields, and uses content-derived idempotency. No provider calls or connection creation.
- `lib/server/reconciliation/service.ts`: exports the existing principal helper and extracts the existing protected context SELECTs into a transaction-scoped internal helper. Existing get() retains the same return data and READ audit.
- `lib/server/reconciliation/gpt.ts`: extracts shared independent GPT verification; adds explicit model/schema/prompt revisions to server-produced results. No financial verification rule is relaxed.
- `lib/server/reconciliation/gpt-prompt.ts`: pins prompt revision `db04-gpt-prompt/1`.
- `lib/server/reconciliation/backend.ts`: adds explicit `persistGPTEvidence(accessToken, result)` and `getGPTEvidence(accessToken, processingId, evidenceId)` methods through existing Finance admission. Existing process/get paths do not query the new tables. These methods fail if invoked before migration; no auto-install/fallback is present.
- `tests/reconciliation-persistence/gpt-persistence.test.ts`: eight offline orchestration/validation tests with an in-memory transaction double.
- `tests/reconciliation-persistence/gpt-evidence.native.test.ts`: ten explicitly gated native PostgreSQL cases, prepared but not executed.

## Minimal schema

`gpt_runs` has primary key `(organization_id, processing_id, evidence_id)` and stores:

- BANK/LEDGER source SHA256 and fixed roles, each FK-bound to the same tenant/job's job_sources.
- Actor membership, database-created timestamp, model/prompt/schema/proposal/verification-policy and financial-policy revisions.
- Source-context, request, raw-proposal and recomputed-verification fingerprints; expected suggestion/abstention counts.
- A fixed `UNRESOLVED` outcome. No amounts, source rows, prompt bodies, provider receipts, API credentials or authorization tokens.

`gpt_items` has primary key `(organization_id, processing_id, evidence_id, item_type, ordinal)` and a composite FK to its run. It stores ordered suggestions and abstentions, explanation, fixed UNRESOLVED outcome, reason codes, bounded allowlisted verification JSON and database timestamp. Suggestion claims retain the exact proposed BANK/LEDGER IDs. Nullable authoritative bindings are separately FK-bound to transactions using `(organization_id, processing_id, kind, record_id)`. A hallucinated ID remains a claim with a NULL authoritative binding; it never becomes a financial record. Abstentions require an unambiguous, existing source record and role. Source SHA256 resolves through the run's job_sources and existing transaction lineage; no extra transaction uniqueness/index is required.

All reasons include `ASSIGNMENT_POLICY_NOT_APPROVED`. Model explanation text is untrusted commentary. It grants no approval or accounting authority. Copied model references are independently checked but their text is not duplicated into storage; the proposal fingerprint preserves linkage to the original generation artifact. This is evidence of the verification result, not a full replay archive of the raw provider response.

## Idempotency, atomicity and protected access

The service computes SHA256 over canonical key-sorted persisted evidence and context; array order is preserved. Server timestamps and actor identity are excluded from the content ID. Identical evidence under the same tenant/job reuses the original row/actor/timestamp. Different payloads produce different immutable evidence rows. A secondary unique constraint also protects the version/fingerprint tuple. PostgreSQL does not recompute the TypeScript canonical content hash; trusted server code owns that derivation, while PK/unique constraints enforce database uniqueness.

A transaction-scoped advisory lock serializes the same tenant/job/evidence ID. Under READ COMMITTED, a waiter reads the committed winner after obtaining the lock. There are no automatic retries. An uncertain commit can be reconciled by resubmitting the exact server result to persistence (no new provider dispatch); a changed source/ranking context is rejected and requires new verification.

The run AFTER INSERT trigger inserts one existing DB04 audit event with action PERSISTED, tenant/job and actor. It runs as SECURITY INVOKER with a fixed pg_catalog search path. Audit denial aborts the evidence transaction. Existing audit format is unchanged: events are job/actor scoped and do not gain a run-ID column. The service inserts the header and all items in one transaction; deferred completion triggers check exact counts and contiguous ordinals at commit. Failed child, FK, RLS, audit or completeness checks roll back the header, items and audit together. Idempotent reuse emits no second PERSISTED event. Protected evidence reads write a READ audit in the same transaction.

Both new tables ENABLE and FORCE RLS using the existing authorized_organization() resolver. The run insert policy binds created_by to the authenticated Finance principal. PUBLIC receives no table/function access; runtime receives only SELECT/INSERT. Runtime has no UPDATE/DELETE/TRUNCATE grant. Existing immutable triggers reject updates/deletes even when RLS is bypassed. A database owner/superuser can still disable triggers or change schema; that operational trust boundary is unchanged. No new SECURITY DEFINER function, role, tenant claim or grant on existing financial tables is introduced.

## Migration order and approval boundary

1. Review existing identity prerequisites and DB04 001–004 in the actual target catalog. Their historical scripts are not rewritten or automatically replayed on an existing database.
2. After separate database-execution approval, run the new native test file against its newly initialized, disposable loopback cluster. Its setup installs the existing prerequisites and proposed 005 in a transaction-capable PostgreSQL runtime. It accepts no hosted database URL.
3. Resolve native failures and review exact SQL/catalog, ownership, ACL and recovery evidence before approving any target application.
4. Only with separate target-specific approval, apply `db04-005-gpt-evidence-review.sql` as migration owner after 004. The script uses BEGIN/COMMIT and deliberately fails on reapplication rather than silently accepting schema drift.
5. Opt-in persistence methods can be used after catalog/security verification. Existing deterministic/E5 paths and protected reads remain available before 005. No install/readiness/deployment manifest includes 005 automatically.

Prepared native test command (DO NOT RUN without approval): set `FINGENCE_DB04_GPT_NATIVE_APPROVED=1`, select already installed PostgreSQL binaries using `FINGENCE_TEST_PG_BIN` if needed, then run the installed Vitest binary against `tests/reconciliation-persistence/gpt-evidence.native.test.ts`. With the flag absent/0, the entire suite skips before initialization. The native suite uses synthetic fixtures and mocked GPT/E5 interfaces only; it never calls Groq or downloads models.

## Recovery and limits

A failed migration transaction rolls back all new DDL. After a successful install, rollback of application code should first disable calls to the new optional methods and leave immutable evidence intact. Do not drop tables or delete audit/evidence rows as routine rollback. Any later removal requires separate approval, retained evidence export/checksums, dependency/catalog review and restoration planning. No destructive down script is included.

Persistence supports completed, schema-valid proposal/abstention responses, including rejected/hallucinated pair claims with UNRESOLVED verification. Provider failures and invalid JSON have no proposal envelope and are not stored by this minimal schema. Durable pre-dispatch reservation, cross-process request budgets, dispatch-uncertainty receipts and failure-event storage remain a separate execution milestone. Nothing here authorizes live inference or guarantees once-only provider dispatch.

Source amounts and accounting evidence are read from immutable DB04 records and never copied into the new tables. Financial/ranking context can gain append-only evidence after inference; persistence rejects a changed fingerprint, rather than overwriting the original verification. Long-lived snapshots may therefore need fresh offline verification. Historical evidence remains read-only. A content hash provides integrity linkage, not provider attestation. Raw generation artifacts remain outside this minimal database schema; future replay retention requires separate review.

SQL constraints, forced RLS, trigger privileges, real locking and commit-time behavior require native PostgreSQL execution to validate. Offline transaction doubles are not proof of database enforcement. Real E5 inference/model quality, hosted compatibility, full application build and hosted production activation are untested here.

## Safe verification evidence

- Selected offline suite: **66 passed**, plus **10 native cases skipped with the explicit approval flag set to 0**. Covers canonical idempotency, schema/tenant/snapshot rejection, rederived verification, hallucinated claims, abstentions, caller-field omission and transaction failure; existing GPT/ranking/verifier/trusted ingestion/processing regression suites pass.
- TypeScript `tsc --noEmit --incremental false`: passed.
- Targeted ESLint for changed TypeScript: passed without warnings.
- Server boundary script and `git diff --check`: passed.
- Native cases prepared: concurrent idempotency and atomic audit/timestamps; abstention/empty results; RLS/actor binding; source/job/outcome/completeness constraints; runtime/owner immutability; audit-denial rollback; incomplete-child rollback; record-FK rollback; deterministic/fuzzy/E5 interface compatibility; expired/revoked/non-Finance session rejection.

Commands use installed binaries directly. Workspace TEMP/TMP avoids the previously observed Windows sandbox rename failure. No pnpm resolution, dependency installation, SQL execution, database connection, Groq call, push, merge or deployment was performed for this task.
