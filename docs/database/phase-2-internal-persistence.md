# Phase 2 internal persistence — implemented

Database schema provisioning is performed only through Supabase SQL Editor. Use `supabase/sql/phase1-clean-setup.sql` for an empty database, or `supabase/sql/phase1-source-file-upgrade.sql` for existing original Phase 1 tables. Hosted FYP A has not received the source-file upgrade; do not run the updated writer there until separately authorized and verified. Original schema fixtures are internal local test/history artifacts, never operational setup instructions.

## Source filename provenance update (local verification only)

The prepared schema upgrade has **not been deployed to hosted FYP A**. Hosted execution requires separate approval and schema verification. Do not run the updated writer against the old hosted schema.

Use `source_file` consistently: it is new on `ingestion_batches` and `validation_issues`, and remains the existing column on `financial_records`. No `source_file_name` column is introduced. New persistence attempts use one validated basename across the three tables. Historical new columns remain NULL; existing record provenance is preserved verbatim. No historical filenames are fabricated.

## Filename flow and compatibility

The developer command remains:

```powershell
corepack pnpm phase2:ingest tests/phase2_financial_input.csv
```

It derives `phase2_financial_input.csv` automatically. No second filename argument is required. Do not run this command against the existing hosted configuration until deployment and ingestion are separately authorized.

```text
physical file -> validated basename -> Chia file metadata
-> persistence request.source_file -> validated plan.batch.source_file
-> ingestion_batches.source_file
-> existing financial_records.source_file
-> validation_issues.source_file
```

The CLI supplies `source_file` explicitly. Retained internal `{ results }` callers can omit it: preflight derives one authoritative value from verified producer file metadata. An explicit value must match every result, including results later consolidated. Different filenames in one attempt are rejected; multiple sheets of one file remain supported. This metadata is provenance, not durable request identity.

Filename validation requires a nonblank string of at most 255 Unicode characters, with no path separators or control characters, excluding `.` and `..`. Useful spelling and Unicode are retained. Paths are never persisted as filenames. Chia already trims/sanitizes and shortens names over 160 characters; the CLI fails safely if Chia changes the physical basename instead of silently storing a different filename. Chia remains unchanged.

The repository binds the single name as SQL parameters. It verifies each record name agrees with the batch before writing and assigns each issue the batch name. Database triggers enforce matching names for named batches, lock parents during child checks, and prevent changing a batch name after records exist. Legacy NULL batch/issue names remain allowed; a non-NULL legacy issue name must match its record. Historical NULLs are not silently backfilled. Financial record names remain NOT NULL as before.

Accepted VALID/WARNING records and ordered warning evidence retain the existing behavior. REJECTED rows contribute counts but are excluded from accepted storage. Transaction/count/ACTIVE/commit-before-receipt, rollback and uncertain-COMMIT handling are unchanged. No automatic retry, security phase or lifecycle feature is added.

Run the local integration test to exercise the real physical CSV, Chia, service, repository and pg adapter using disposable loopback PostgreSQL:

```powershell
corepack pnpm exec vitest run tests/persistence/repository.integration.test.ts
corepack pnpm exec vitest run tests/persistence/cli.test.ts
```

These tests do not load developer `.env.local`. Missing-configuration subprocess tests retain the explicit test-only environment-loader disable switch and an allowlisted environment. Normal developer invocation still intentionally loads `.env.local`, so it is not a safe substitute for the local tests here.

3 October 2026. Continues approved Phase 2A commit `b2291473dfeccdbf07a875f889736fa206043904` in `FYP A JQ/FYP`, branch `feature/database-ingestion-foundation`, personal origin `https://github.com/jiaqi538/FYP.git`. The initial checkout was clean. This remaining work has not been committed or pushed.

## Implemented flow and files

Trusted server engine results → Phase 2A preflight and owned mapping snapshot → internal new-attempt service → PostgreSQL repository → one connection/transaction → batch UUID → accepted record UUIDs → ordered warning issues → counts/completion → commit → receipt.

| File | Responsibility |
| --- | --- |
| `lib/server/db/postgres.ts` | Server-only configuration, pg pool, exact per-pool parsers, connection and transaction lifecycle |
| `lib/server/persistence/repository.ts` | Parameterized inserts, database-owned UUIDs/FKs, count verification and batch completion |
| `lib/server/persistence/service.ts` | Explicit new-attempt intent, Phase 2A preflight/mapping, safe receipt/errors; production service factory and shutdown |
| `lib/server/persistence/contracts.ts` | Extended safe errors and new-attempt request/receipt types; original financial contract unchanged |
| `tests/persistence/postgres.test.ts` | Configuration/TLS/parsers, single-connection lifecycle, deadlines, rollback and uncertain commits |
| `tests/persistence/repository.test.ts` | SQL parameters/relationships, returned UUID and affected-row checks |
| `tests/persistence/service.test.ts` | Preflight-before-storage, snapshots, unsupported retries and safe failures |
| `tests/persistence/repository.integration.test.ts` | Disposable real PostgreSQL/WASM execution through the actual pg wire protocol |
| `tests/persistence/verify-hosted-compatibility.sql` | Read-only application schema/RLS/grant metadata comparison |
| `tests/persistence/schema-compatibility.mjs` | Local migration metadata baseline, with no external connection |
| `package.json`, `pnpm-lock.yaml` | Runtime/development dependencies and explicit persistence/database test commands |
| `docs/database/phase-2-persistence-design.md` | Links current implementation status while preserving earlier design/Phase 2A history |

Added runtime dependencies: `pg` **8.23.1**, `server-only` **0.0.1**. Added development dependencies: `@types/pg` **8.23.1**, `@electric-sql/pglite` **0.5.8**, `@electric-sql/pglite-socket` **0.2.11**. The pnpm lockfile pins resolution. No ORM, API framework or production test database is added. Existing Vitest discovery already includes these files; no further configuration change was needed.

## Internal caller contract

The caller must be a trusted server environment executing the existing engine. This does not authorize browser-produced results or replace authentication/source verification.

```ts
import { createServerPersistenceService } from "@/lib/server/persistence/service";

// Reuse one service/pool for the server lifecycle; close on shutdown.
const persistence = createServerPersistenceService();
const receipt = await persistence.persistNewAttempt({
  intent: "NEW_ATTEMPT_NO_RETRY",
  results: trustedEngineResults,
});
// At lifecycle shutdown: await persistence.close();
```

Receipt fields are `outcome: PERSISTED_NEW_ATTEMPT`, `batch_id` (database UUID), `ingestion_batch_id` (producer text), `accepted_record_count`, and `warning_count`. The repository prepares the receipt internally but the adapter returns it only after COMMIT succeeds. No record contents, SQL, credentials or connection details are returned.

`NEW_ATTEMPT_NO_RETRY` is explicit caller intent to create new history, **not an idempotency guarantee**. Requests without that intent, or carrying replay/idempotency/retry metadata, fail with `IDEMPOTENCY_UNSUPPORTED`. No retry loop or deduplication lookup is implemented. Two explicitly declared new attempts create two historical batches, even for identical source or producer IDs. The service cannot recognize a caller falsely declaring an old request as new. Ambiguous or possibly repeated deliveries must not be submitted to this interface; durable delivery/replay protection requires the OPEN database-backed request registry. Do not route queues with automatic redelivery to this service yet.

Mixed producer IDs still fail Phase 2A preflight. All supplied results, including replaced same-dataset results, are preflighted before latest-dataset selection. The pure mapper can prepare an all-rejected zero-record plan, but the writer rejects it with `EMPTY_ACCEPTED_BATCH_UNSUPPORTED` before checking out a connection; its activation policy remains OPEN.

## Server configuration and security

Real connection credentials must be supplied only by the server environment through `SUPABASE_DATABASE_URL`. No real value was created, read, saved or printed in this task. Existing `.env*` ignores remain unchanged. No `.env.example` was needed.

The adapter, repository and service all import `server-only`. Next.js rejects their import into client modules. Pure Phase 2A types/helpers remain resource-free. New server-module tests explicitly mock the guard only within tests; production modules retain it. A standalone trusted Node worker must use the appropriate React server condition (`node --conditions=react-server`) rather than removing the guard. No UI, client barrel, server action or route imports this writer.

Configuration parses PostgreSQL URL fields explicitly instead of allowing URL SSL settings to override the TLS object. Non-loopback hosts require certificate-verified TLS. `sslmode=require` and `verify-full` both retain `rejectUnauthorized: true`; disabled TLS is allowed only for loopback development. Unknown SSL/query options are rejected safely. A server-only `SUPABASE_DATABASE_CA_CERT` may supply an approved CA certificate when the deployment requires it; certificate validation must not be disabled to address trust errors. [node-postgres TLS guidance](https://node-postgres.com/features/ssl).

The pool is bounded to four connections, with 5-second connection timeout and 10-second idle timeout. Reuse the service rather than constructing a pool per request. Statement timeout is 10 seconds, lock timeout 3 seconds, idle-in-transaction timeout 10 seconds and driver query timeout 11 seconds. A 30-second operation deadline is checked between awaited statements and before COMMIT. This is not a hard wall-clock cancellation timer: an in-flight statement/commit and rollback cleanup can extend it by their bounded timeouts. There is no background retry. Production runtime/network reachability, certificates and direct/session/transaction pooling remain deployment decisions.

All SQL identifiers come from fixed repository constants; values use positional parameters. Insert text, decimals, dates and JSON are never concatenated into SQL. JSONB original null is serialized as JSON `null`, not SQL NULL. Idle pool errors are handled without logging raw database errors. No financial record, SQL error content, password or URL is logged by runtime code.

## Exact values, evidence and identities

All five monetary fields remain decimal string/null parameters. Per-pool NUMERIC parsing returns text and never mutates global pg parsers; DATE and timestamp values also return text, avoiding date shifts. Existing exact ledger validation uses BigInt subtraction, with no JavaScript floating-point money conversion. PostgreSQL preserves exact numeric value, not arbitrary original numeric text formatting. [node-postgres type handling](https://node-postgres.com/features/types).

Text identifiers retain leading zeros. Transaction and posting dates remain independent; canonical date/basis, source monetary representation/direction, currency origin and approved transformations are unchanged. No conversion, universal sign interpretation or accounting eligibility rule is added.

Each parent/record UUID is generated by PostgreSQL and obtained with RETURNING. The writer attaches financial rows using both the parent UUID and original producer ID. Warning rows attach to the returned record UUID with zero-based issue ordinals. Source row ID is lineage only. All source system/file/sheet/row/hash/timestamp fields are retained. REJECTED rows and rejected issues never enter accepted storage; rejected count remains on the batch. No raw/rejected retention mechanism is introduced.

## Atomicity and lifecycle

The adapter checks out one connection and runs BEGIN, transaction-local timeout settings, all repository statements and COMMIT on that connection. The repository inserts PROCESSING parent metadata, accepted records and issues, verifies accepted/valid/warning/issue counts against the plan, then marks ACTIVE/completed_at. ACTIVE here records completion of a nonempty accepted write; it does not certify accounting accuracy, model readiness, uniqueness or a final reporting population. The writer does not mark older batches SUPERSEDED, link predecessors or delete history.

Any required operation or deferred constraint failure prevents a successful receipt. Pre-commit errors roll back. SQLSTATE integrity/transaction-rollback errors at COMMIT are treated as definite failure. Transport/other ambiguous COMMIT errors return `COMMIT_OUTCOME_UNKNOWN`; attempting ROLLBACK afterward does not prove that an earlier COMMIT did not happen. Failed rollback returns `ROLLBACK_UNCONFIRMED`. Uncertain/broken connections are destroyed; all checked-out connections are released in finally. Never blindly retry either uncertain result. There is no durable FAILED batch created after rollback and no separate failure audit table.

Runtime failures use fixed `PersistenceError` codes/messages: configuration, availability, preflight, unsupported intent/empty accepted batch, persistence failure and uncertain commit/rollback. Underlying exceptions and values are not attached or returned. Disposal failure is also sanitized.

## Verification results

| Check | Result |
| --- | --- |
| Phase 2A synthetic tests | 83 passed, unchanged |
| Adapter/repository/service unit tests | 31 passed |
| Local pg/PostgreSQL integration tests | 17 passed |
| Complete persistence suite | **131 passed** |
| Existing ingestion tests | 97 passed, 1 skipped, 1 existing failure |
| Full project suite | **228 passed, 1 skipped, 1 existing failure** |
| TypeScript, no emit/incremental disabled | Passed |
| ESLint | Passed |
| Diff/whitespace and scope review | Passed; only intended Phase 2 files |

The known failure remains `tests/ingestion/handoff.test.ts:160`: CRLF checked-in evidence versus LF exporter output. No ingestion implementation, contract, fixture or test was changed. The skipped test remains the optional external workbook. No real financial data was used.

Local integration starts a fresh in-memory PGlite database, executes the **current operational clean-schema SQL**, and binds a PostgreSQL socket only to `127.0.0.1` on an OS-assigned ephemeral port. The actual production pg adapter/repository/service communicates through this socket. No hosted connection/environment credential is used. All pools, sockets and databases are closed afterward. Local cleanup truncates only the three disposable test tables. Simulated anon/authenticated roles exist only in that disposable environment.

Tests verify VALID/WARNING persistence, issue order and JSON null/text/boolean/Excel evidence, batch/record UUID relationships, all monetary representations, large/negative/zero precision, leading zeros, independent dates/basis, transformations, lineage, rejected exclusion, multiple rows, aggregate counts, SQL-injection-shaped literals and nonmutation. Real database state checks prove rollback after parent/record insertion, invalid warning insertion, count mismatches and deferred warning constraints at COMMIT. Additional tests cover unavailable pools, release/destroy behavior, deadlines, unsupported retries and an **actual committed transaction with simulated lost acknowledgement**: one complete attempt remains, no success receipt is returned and no retry occurs. RLS and client read/write denial are verified locally; temporary local read grants are rolled back to demonstrate row-policy denial.

PGlite is a PostgreSQL WASM engine; its single-connection socket multiplexer does not establish hosted TLS/authentication, pool saturation behavior, deployment performance or general concurrent-session equivalence. [PGlite socket limitations](https://pglite.dev/docs/pglite-socket).

Commands:

```text
pnpm test:persistence
pnpm test:db
node tests/persistence/schema-compatibility.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
pnpm lint
pnpm test
```

## Hosted compatibility — verified read-only

After implementation/local tests/TypeScript/lint and code review passed, the existing authenticated dashboard for personal **FYP A**, project **fhipzomczevbpybezzxu**, was used only for metadata SELECTs. No connection credential was opened or copied. No hosted test writes, migrations, resets, data deletion, grants or policies were performed. SQL Editor automatically created a private query draft; only schema metadata SQL was entered, and no explicit Save action was used.

The read-only query in `tests/persistence/verify-hosted-compatibility.sql` matched the local migration baseline:

| Metadata | Hosted and local |
| --- | --- |
| Tables / columns / indexes / application constraint triggers | 3 / 56 / 11 / 2 |
| RLS enabled / client policies / client table privileges denied | true / 0 / true |
| Column/default/type/nullability fingerprint | `a78b9f65c08ca84ddde4e8c96dce2de1` |
| Constraint fingerprint | `002dbaa7a8d14592a4f655fa879dc3c5` |
| Index fingerprint | `4296f4ae5fe679a7f0fdcb17c6fbff0b` |
| Trigger fingerprint | `5ed4a15a48cb0bd0d35ba25bb4abdde9` |
| Whitespace-normalized warning function fingerprint | `278578fe6c2657c8ab742384536be0ed` |

Initial raw hashes differed because the newer local PostgreSQL catalogs NOT NULL constraints separately and the function's whitespace differed. Nullability is checked in the column fingerprint; constraint comparison excludes PostgreSQL 18's separate `contype = n` entries. The hosted warning function's complete definition was read and compared: logic, language and fixed search_path match. Function whitespace is normalized for the recorded fingerprint. No schema conflict or repair was needed.

This verifies schema compatibility and current client restrictions, **not** a credentialed hosted pg/TLS connection or deployed application writes. Those remain unverified until the user configures approved server credentials and final privileges. No hosted financial rows were read.

## Open decisions and future backend work

- Durable request identity/registry, uniqueness/replay/conflict rules and commit-outcome reconciliation. Duplicate delivery is not protected; explicit new attempts preserve history.
- Final reprocessing/superseding lifecycle, active reporting population and all-rejected activation.
- Production writer role/privileges, authentication, authorization and tenancy. RLS remains enabled, but owner/BYPASSRLS credentials would require a trusted authorization boundary.
- Original/rejected evidence storage, retention, source verification and final batch context metadata.
- Deployment/pooler/network/TLS trust decisions, capacity and performance. Current inserts are individual parameterized operations, not a bulk throughput implementation; large batches may hit bounded deadlines and roll back.
- Durable requests, technical reconciliation and batch lifecycle are the next planned backend phase. API/browser integration remains later planned work. Authentication/cybersecurity belongs to the separate team security responsibility; the internal writer must not be exposed without that integration.

No public HTTP API, browser persistence, authentication or tenancy was added. Chia's ingestion implementation/contracts/tests and Phase 1 migration remain unchanged. `FYP-A-B` was never accessed or modified. No real financial data or real credentials were used or exposed. Nothing from this remaining Phase 2 work was committed or pushed.
