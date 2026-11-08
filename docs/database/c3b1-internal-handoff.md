# C3-B1 internal persistence handoff

`createGroupedPersistenceService(database)` in `lib/server/persistence/grouped.ts`
accepts `{ attempt_id, results }`. Allocate a UUID before calling it, retain that
UUID if an error occurs, and supply trusted engine-produced version 0.1 results.
This is an internal interface, not Chia's future AcceptedDataPayload contract.

Every result is independently validated by the existing Phase 2 validator and
mapper before writes begin. Each receives its own database batch UUID, producer
batch ID, basename, dataset ID and counts. Matching dataset content in independent
producer batches is allowed; repeating the same producer batch/dataset/filename
inside an attempt is rejected rather than silently consolidated.

One PostgreSQL transaction writes the durable parent attempt, child batches,
accepted records and ordered warnings. No nested transaction or automatic retry
occurs. A receipt is returned only after the transaction adapter acknowledges
COMMIT. Failure in any child rolls back all children and the attempt row.
The UUID primary key rejects reuse of a committed attempt ID, including a changed
payload. Explicitly using a different UUID creates new history; this does not
detect economic duplicates or prevent a caller from deliberately creating them.

Zero-accepted datasets finish as COMPLETED_EMPTY, including all-rejected datasets.
No financial rows are invented. Batch context preserves summary, profile, mapping,
options, producer context, file metadata, sheet identity, header and columns.
Rejected counts are retained; rejected raw records are not newly persisted.
Nonempty datasets retain ACTIVE status. The retained Phase 2 service/CLI continues
its previous behavior and receipt shape, including its legacy empty-input policy.
Use the grouped service with one result for C3-B1 single-dataset empty support.

## Schema preparation

Apply `supabase/sql/c3b1-grouped-persistence-upgrade.sql` once, after the current
Phase 1 source-file foundation. This additive transactional script introduces
`persistence_attempts`, nullable parent/dataset columns on `ingestion_batches`,
foreign-key/unique constraints and COMPLETED_EMPTY checks. Existing rows receive
NULL parent/dataset identity without backfill. Original migrations, operational
clean setup and test fixtures remain unchanged. The new parent table uses the
existing server-only table policy; existing security objects are unchanged.
Hosted application remains pending separate user approval through SQL Editor.

## Investigating an uncertain COMMIT

Call `investigateAttempt(attempt_id)` against the same authoritative writable
database used for the original write. Grouped writes and investigation request
READ COMMITTED in BEGIN, before the adapter's first timeout-configuration query.
The adapter's optional isolation argument leaves legacy callers' session defaults
unchanged. Investigation
checks primary/writable status, then tries the same transaction advisory lock
used by the writer. It never invokes persistence.

- CONFIRMED_COMMITTED: the durable parent exists and all expected child batches
  have completed statuses.
- CONFIRMED_NOT_COMMITTED: the primary writer fence was acquired and a subsequent
  fresh snapshot contains no parent. This describes preceding/current writes at
  the investigation point, not a guarantee about a future explicitly new call.
- UNRESOLVED: writer lock unavailable, replica/read-only target, incomplete
  evidence, database failure or uncertain investigation transaction completion.

A missing record without the primary/fence evidence is never declared rollback.
Do not investigate against a different project, stale replica, restored database,
or after administrative removal of attempt history. Do not automatically retry
after COMMIT_OUTCOME_UNKNOWN or ROLLBACK_UNCONFIRMED. Retain the attempt UUID and
investigate first. Legacy Phase 2 writes have no grouped attempt UUID and cannot
be retroactively investigated by this method.

## Final C1/C2 adapter requirements

Chia's manifest must confirm AcceptedDataPayload shape, dataset selection and
reprocessing semantics, empty-dataset metadata, batch ownership, supported
metadata/retention, attempt UUID transport and caller handling of receipts/errors.
Adapt that contract into the internal service later; no ingestion, analytics,
frontend or HTTP interface changes are included here. Chia's reader currently
rejects header-only files. Zero-row persistence support is tested with an explicit
internal fixture; producer support remains a separate integration decision.

## Local verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm check:server-boundary`,
`node supabase/tests/verify-local.mjs`, `node supabase/tests/verify-upgraded.mjs`,
and `node tests/persistence/schema-compatibility.mjs`.
Grouped integration tests apply the new migration to disposable PGlite databases,
including a populated historical schema. The existing repository integration
suite additionally exercises the pg wire adapter and actual lost COMMIT
acknowledgement. `tests/persistence/grouped.postgres.test.ts` creates a separate
temporary native PostgreSQL cluster, restricted to loopback with a fresh data
directory and port. It tests real advisory-lock contention, two concurrent writers,
actual COMMIT with lost acknowledgement, rollback from a database trigger error,
session defaults READ COMMITTED/REPEATABLE READ/SERIALIZABLE, incomplete evidence
and legacy persistence on the upgraded schema through the production adapter.
It never uses the running service, developer connection settings or existing data.
On machines without the PostgreSQL binaries this suite is skipped, which is not
evidence of native concurrency verification. Set FINGENCE_TEST_PG_BIN to the
local PostgreSQL bin directory if necessary (Windows executables).
Replica decision branches remain injected; hosted behavior is not tested.
