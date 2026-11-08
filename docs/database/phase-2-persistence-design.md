# Phase 2 persistence design

Database schema provisioning is performed only through Supabase SQL Editor. Use `supabase/sql/phase1-clean-setup.sql` for an empty database, or `supabase/sql/phase1-source-file-upgrade.sql` for existing original Phase 1 tables. Hosted FYP A has not received the source-file upgrade; do not run the updated writer there until separately authorized and verified. Original schema fixtures are internal local test/history artifacts, never operational setup instructions.

3 October 2026. Original inspection used only `FYP A JQ/FYP`, branch `feature/database-ingestion-foundation`, with a clean initial working tree. Sections 1–17 record the approved design direction at that time; the Phase 2A and Phase 2B/2C status sections record subsequent implementation. Original design/Phase 2A scope statements are historical; current details are in the linked implementation report.

## 1. Existing backend architecture

The checkout uses Next.js **16.3.6** App Router, React **19.2.8**, strict TypeScript, Tailwind 4 and pnpm **11.19.0**. The older architecture document mentions Next 16.3.3; current package.json is authoritative for this checkout.

Routes are `/`, `/data`, `/transactions`, `/reconciliation`, `/analytics`, `/forecasting`, `/anomalies` and `/reports`. These are UI pages, not HTTP ingestion endpoints. The pages are client components; `app/layout.tsx` is the root layout. No route handlers, authentication middleware/proxy, server actions, database client, repository or persistence service were found. Shared `lib/types.ts`, `lib/mock-data.ts` and `lib/formatters.ts` serve the prototype; they are not canonical database models.

`lib/ingestion/` contains a React-independent TypeScript engine usable from Node. Its present caller, `app/data/page.tsx`, processes files in browser memory and generates a session batch ID. Uploaded data does not populate other mock-driven pages. Browser approval flags do not establish server authorization.

No application Supabase SDK/PostgreSQL driver or application environment-variable convention exists. `.gitignore` excludes `.env*`. The test regeneration flag `FINSIGHT_REGENERATE_HANDOFF_EXAMPLE` is tooling-only. TypeScript uses strict mode, bundler resolution, `@/*` aliases and explicit contract types. Vitest runs in Node, but its include pattern currently selects only `tests/ingestion/**/*.test.ts`.

## 2. Existing relevant files

| Files | Relevance |
| --- | --- |
| `package.json`, `tsconfig.json`, `vitest.config.mts`, `AGENTS.md` | Framework, conventions, test discovery and repository instructions |
| `app/data/page.tsx`, `components/ingestion/` | Current browser/session orchestration; not a trusted backend |
| `lib/ingestion/models.ts`, `index.ts`, `pipeline.ts` | Public types, exports, accepted output and consolidation |
| `docs/ingestion/architecture.md` | Financial semantics, validation, replacement and compatibility |
| `examples/ingestion/consume.ts`, `tests/ingestion/handoff.test.ts` | Version preflight, warnings, lineage, decimal strings and replacement behavior |
| `docs/handoff/TEAM_HANDOFF.md`, `AI_CONTEXT.md` | Ownership, trust limits and OPEN interfaces |
| `supabase/tests/fixtures/phase1-original-schema.sql` | Original immutable test/history baseline only; operational schema is under `supabase/sql/` |
| `docs/database/initial-ingestion-foundation.md` | Mapping, deployment evidence and unresolved policies |
| `supabase/seed.sql`, `supabase/tests/verify_ingestion_foundation.sql`, `verify-local.mjs` | Existing synthetic database verification resources |

The local migration and database documentation were inspected. Existing hosted verification is documented Phase 1 evidence; this task did not reconnect to or reverify Supabase.

## 3. Current ingestion → database mapping

| Input | Persistence mapping |
| --- | --- |
| Result `context.batchId` | `ingestion_batches.ingestion_batch_id`; retained separately from generated database UUID |
| Result schema/ruleset versions | Parent batch versions, explicitly supported `0.1` / `0.1` |
| Selected results' summary counts | `rows_received`, `valid_count`, `warning_count`, `rejected_count`; reconcile with selected records before writing |
| Options, mappings, dataset identity and producer timestamp | Proposed minimal versioned batch `context` JSONB; exact shape is OPEN; do not copy full raw results |
| Parent database UUID | `financial_records.batch_id`; composite FK also checks producer batch ID |
| `transaction_date`, `posting_date`, `canonical_date`, basis | Independent DATE fields and selected basis; no fallback or overwriting |
| Reference, source transaction/account/entity identifiers | TEXT/null; retain leading zeros |
| Description, counterparty, entry side, monetary basis, currency and currency basis | Corresponding columns without financial reinterpretation |
| Debit, credit, source amount, ledger net, balance | Decimal strings passed as NUMERIC SQL parameters; null stays null |
| `transformations` | JSONB array preserving approved transformation evidence |
| Accepted `ingestion_status` | VALID/WARNING only |
| Source system/file/sheet/row number/row ID/hash, batch ID and timestamp | Corresponding provenance columns, unchanged; CSV sheet remains null |
| `validation_messages` | Ordered `validation_issues`, indexed by zero-based ordinal and linked to record UUID |
| Issue `sourceColumn`, `originalValue` | `source_column`, `original_value`; preserve JSON null, boolean, string or typed Excel object |
| REJECTED rows/issues, raw/staging candidates | Excluded from accepted tables; durable evidence storage is OPEN |

Each table owns a generated UUID. `source_row_id` is lineage, never a primary key or economic deduplication key. Money retains its exact numeric value; PostgreSQL does not promise original lexical formatting. Financial dates remain calendar strings at the boundary; timestamps represent instants.

## 4. Mismatches and integration gaps

No incompatible canonical field mapping was found for trusted current engine output. The following require boundary design, not immediate foundation replacement:

- Canonical monetary fields are strings; database fields are NUMERIC. Driver coercion must be prohibited on both writes and reads.
- TypeScript `ValidationIssue` permits REJECTED severity, but accepted storage permits WARNING issues only. Runtime checks must enforce VALID with zero issues and WARNING with at least one issue, all WARNING. JSON null must not become SQL NULL.
- Producer `ingestion_batch_id` is intentionally nonunique. Its index and `(id, ingestion_batch_id)` uniqueness do not enforce retry idempotency.
- One browser session can share a producer batch ID across datasets and reruns. A consolidated call can also contain different producer IDs; one parent batch cannot represent those rows indiscriminately. Partition by producer ID and retain dataset metadata, or reject mixed IDs under a documented initial contract.
- `consolidate` replaces earlier same-dataset results in memory; database attempts retain history. That replacement must not silently supersede persisted attempts.
- Summary counts are not automatically cross-checked against child records. ACTIVE is currently a label, not a database completeness guarantee.
- Batch context has no agreed metadata schema; source files and rejected/raw evidence have no durable storage contract. Worksheet index survives in source_row_id but has no separate record column; preserve dataset metadata when needed rather than parsing IDs as business keys.
- Current browser results are untrusted external input relative to privileged persistence. No authentication, tenant ownership or production grants exist.
- The synchronous visitor example is not an async transactional writer; callback failure cannot undo earlier visits.
- New persistence tests would currently be excluded by Vitest configuration. Phase 1 documents an existing CRLF/LF handoff byte-comparison failure; it was not rerun or fixed here.

## 5. Proposed persistence architecture

Start with a small **internal server-only persistence service** and one PostgreSQL repository, following the existing `lib/` organization. Do not introduce an ORM, separate backend framework or public endpoint by default.

Flow: trusted server execution of existing ingestion engine → preflight every supplied version → validate and snapshot input → consolidate selected datasets → partition by producer batch ID → map accepted records → repository transaction → return database identities and counts.

The future service accepts readonly `IngestionResult[]` plus trusted persistence-request metadata. Pin supported versions independently of producer constants. Validate every supplied result before consolidation, including replaced results. Use only selected `.normalized` records as financial input; processed records may support count/evidence consistency checks, never inserts. A REJECTED object injected into normalized input causes an invalid-input failure, rather than silently reducing counts.

Validate dates, decimal text, provenance/context consistency, enum values, warning shape, transformations and count agreement before opening a transaction. Do not invent stricter accounting or currency rules. Snapshot primitive/JSON values so caller mutation across async waits cannot alter the write plan. Return persisted batch UUIDs, accepted counts and a replay/new outcome; return record UUID mappings only when consumers need them.

The present browser UI is not automatically integrated. A future trusted Node caller can invoke the engine and persistence directly without changing Chia's implementation. Browser integration needs its own agreed authorization and server processing boundary.

## 6. Proposed file/module structure

| Future module | Responsibility |
| --- | --- |
| `lib/server/db/postgres.ts` | Server-only pool, environment validation, transaction connection lifecycle |
| `lib/server/persistence/contracts.ts` | Request/result types, supported versions and safe error codes |
| `lib/server/persistence/validate.ts` | Runtime preflight and consistency checks, no database side effects |
| `lib/server/persistence/map.ts` | Explicit canonical-to-column/issue mapping; no money arithmetic |
| `lib/server/persistence/repository.ts` | Parameterized SQL and injectable transaction interface |
| `lib/server/persistence/service.ts` | Preflight, consolidation/grouping, idempotency orchestration and atomic persistence |

Keep database imports out of `lib/ingestion/index.ts` and client-shared barrels. Server entry points must enforce server-only imports; test pure helpers and inject repository dependencies independently.

## 7. Supabase/PostgreSQL server access

Recommend a Node PostgreSQL driver such as `pg`, connecting from trusted server code to the existing Supabase PostgreSQL database. It provides an explicit multi-statement transaction without needing a new database RPC. Keep NUMERIC decoding as text; do not register numeric-to-Number parsers. Use a checked-out connection for the entire transaction.

Proposed secret variable: `SUPABASE_DATABASE_URL`, configured only in the server environment/local ignored environment file. No `NEXT_PUBLIC_` prefix, browser SDK credential, public serialization or logs. Validate presence at server startup/use without printing its value. Apply TLS certificate verification and bounded pools/timeouts.

Choose direct connection or session pooler for a persistent Node runtime, according to network reachability; transaction pooler for a future serverless deployment, with no named prepared statements or session-state dependence. Parameterized SQL remains required. Deployment/runtime choice is OPEN. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [prepared-statement limits](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL).

Keep RLS and revoked client grants intact. With no policies, ordinary client roles cannot persist. Owners/BYPASSRLS roles bypass row policies: privileged server access therefore requires application authorization and careful credential isolation. Production should agree a constrained writer role or narrowly privileged function; do not treat the administrative postgres credential as the final production authorization design. No role/grant/policy is provisioned here. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Alternative: a server Supabase SDK invoking one narrowly authorized transactional RPC. Separate SDK inserts into three tables do not provide batch atomicity. RPC adds a migration and permission surface, so direct PostgreSQL is simpler for this initial internal service. No Supabase URL/API key is required by the recommended direct-driver approach.

## 8. Is an HTTP API needed now?

No. Implement and verify the internal service first for a trusted server caller. The current browser flow is not such a caller, and adding a write endpoint without authentication/server verification would cross the trust boundary unsafely.

If browser persistence is later approved, a possible authenticated `POST /api/ingestion/batches` accepts an authorized source/upload reference, reviewed mappings/options and a persistence idempotency key. Server code retrieves/verifies source bytes and runs the existing engine; it does not accept browser claims of VALID as proof. Final payload, source storage and authentication are OPEN. Return `201` for a committed new request, `200` for replay, `409` for key/payload conflict, `400/422` for invalid input, `401/403` for access denial and sanitized `500/503` for failures. Never acknowledge success before commit.

## 9. Transaction strategy

Recommended initial unit: one persistence invocation, including all selected producer groups, committed atomically. Batch scope and practical limits require team agreement; do not silently split one required atomic request into independent commits.

Within one connection: BEGIN → resolve/reserve retry identity → insert parent batch(s) as PROCESSING → insert accepted records, obtaining UUIDs → insert all ordered warning issues → verify counts → set completed timestamp and ACTIVE if agreed completeness requirements are satisfied → COMMIT. Deferred warning triggers are checked at commit. Internal SQL chunks may bound parameter size but remain in the same transaction. An all-rejected dataset can retain counts and zero financial rows if the agreed activation policy permits it.

Any statement or commit failure rolls back the whole transaction. Release the connection in finally; discard unusable connections. A rolled-back PROCESSING batch is not a durable FAILED attempt. Durable failure auditing, if needed, is a separate sanitized mechanism and remains OPEN. Future superseding must lock affected batches in stable UUID order and change old/new lifecycle state in the same transaction.

## 10. Error handling

Use stable categories: unsupported version, invalid input, duplicate-request conflict, unavailable database and unexpected persistence failure. Keep SQL text, credentials, financial values and raw database messages out of caller responses/logs. Logs contain safe correlation IDs and bounded diagnostic codes.

Retry only classified transient transaction failures with bounded backoff and a stable idempotency key. A connection loss during commit has an unknown outcome; do not blindly insert again. Resolve the recorded request outcome before retrying. Validation and constraint violations are not automatically retried. Return no partial success result.

## 11. Reprocessing and idempotency

| Situation | Proposed behavior / unresolved policy |
| --- | --- |
| Same persistence request twice | Stable backend request key: identical payload returns existing result; different payload conflicts |
| Same producer batch ID twice | Not sufficient to infer replay; sessions/reruns legitimately reuse it |
| Same file/sheet processed again | Separate attempt unless an explicit request replay; economic deduplication and superseding policy OPEN |
| Failure before commit | Full rollback; safe retry only with request identity |
| Lost commit acknowledgement | Look up durable request result; no blind retry |
| Superseded batch | Preserve history; explicit authorized transition and reporting population OPEN |
| Concurrent duplicate requests | Require database-enforced uniqueness and conflict handling, not a check-then-insert query |

Recommended future addition: a durable request registry keyed by trusted scope + backend idempotency key, with deterministic digest of the complete persistence-relevant plan and its outcome/batch relationships, written in the same transaction. Key scope, metadata layout and migration require agreement. Existing batch context alone, source hashes, source_row_id or producer batch ID cannot provide database-enforced request uniqueness. No schema change is made now; uncontrolled retries should remain disabled until this gap is addressed. Do not upsert financial rows by source identity or silently delete duplicate raw rows that ingestion intentionally accepts with warnings.

## 12. Security strategy

Only authorized server callers reach the writer. Browser outputs and approval flags cannot confer trust. Keep secret access isolated to server-only modules, preserve RLS/no broad anonymous policies, use parameterized fixed SQL with allowlisted columns, and keep financial/rejected data out of logs. Reject malformed or inconsistent accepted input before writes; enforce database constraints as a second boundary. Preserve decimal/identifier strings and warning/lineage evidence. Bound payload size and transaction duration. Durable idempotency prevents request duplicates; a single transaction prevents partial writes. Authentication, tenancy and future evidence-store permissions must be resolved before public integration.

## 13. Testing strategy

Use synthetic engine output and independently stated expectations. Unit tests exercise preflight, mapping and orchestration with an injected repository. Database integration tests use a fresh disposable local PostgreSQL/PGlite database and the current clean-schema SQL; mocked transaction calls alone cannot establish rollback correctness.

- VALID record: UUID relationship, no issues; WARNING record: all issues, exact order and original JSON preserved.
- REJECTED rows never enter accepted storage; tampered normalized REJECTED/status-message mismatch fails before writes.
- Decimal values beyond Number safety, fractional precision, negatives, zero and null round-trip as text; leading-zero identifiers remain unchanged.
- All lineage, independent dates/basis, currency origin and transformations survive without input mutation.
- Multiple rows/datasets/producer IDs have correct parent associations and reconciled counts; incompatible replaced results fail before writes.
- Inject failure after parents, records and issues; verify all tables return to their prior state. Test deferred commit failures too.
- Same request replay, key/payload conflict, concurrent requests and uncertain commit outcome obey the eventual idempotency contract.
- Invalid dates/decimals/versions/provenance/counts, SQL-injection-shaped strings and database outage produce safe errors, no partial result or sensitive logs.
- Reverify anon/authenticated denial locally; test server-import isolation and secret omission from client bundles in the eventual implementation.

Phase 1's documented 23 accepted synthetic handoff rows are useful integration fixtures. Existing byte-comparison failure is a known separate baseline issue, not justification to change Chia's tests. No test execution or runtime installation was necessary for this inspection-only report.

## 14. Files that would be created

The six modules in section 6; `tests/persistence/validate.test.ts`, `map.test.ts`, `service.test.ts`, `postgres.integration.test.ts`; optionally an isolated synthetic fixture helper. A later reviewed idempotency migration and SQL verification belong under `supabase/sql/` and `supabase/tests/`. An environment example with placeholders only is optional after naming decisions. No endpoint is planned now.

## 15. Existing files that would need modification

`package.json` and `pnpm-lock.yaml` for the selected driver/server-only dependencies and types; `vitest.config.mts` to discover persistence tests; database documentation to describe the eventual writer and approved metadata/idempotency contract. Test scripts may need a distinct local integration command. No ingestion implementation, handoff example/test, mock page or database foundation needs modification for the internal service itself. Browser integration is a separate future scope; do not wire the Data page now.

## 16. OPEN team decisions

Persistence attempt scope across datasets/producer IDs; request key ownership/scope and registry schema; final batch context metadata; deployment/runtime/pooling; production writer privileges; authentication and tenant authorization; accepted-data transport if needed; source/rejected evidence storage and retention; ACTIVE completeness and all-rejected behavior; superseding/concurrency/lifecycle rules; reporting population; economic duplicate ownership; warning eligibility for analytics. Client accounting conventions remain under existing ingestion authority. These are not settled by this report.

## 17. Recommended implementation order

1. Agree batch/request scope, idempotency, metadata and server trust boundary; preserve financial contract `0.1`.
2. Add pure persistence contracts, preflight and mapping with synthetic tests.
3. Agree and separately review any idempotency migration/privilege design; verify it locally before hosted changes.
4. Add server-only driver/repository and transaction integration tests, including rollback and commit uncertainty.
5. Add service orchestration and retry/conflict tests; verify counts, warnings, lineage and exact money end to end locally.
6. Configure server secrets/roles only in a separately authorized implementation/deployment task; never commit credentials.
7. Integrate an agreed trusted server ingestion caller. Consider browser/API integration only after authentication and source verification exist.

## Original design-task scope confirmation

- `FYP-A-B` was never accessed or modified.
- Chia's ingestion implementation and its contracts/tests were not modified.
- Supabase/database was not modified or interacted with during this task.
- No implementation changes were made. Only this design report was created; no commit or push was performed.

## Phase 2A — IMPLEMENTED, 3 October 2026

Only the pure persistence foundation is implemented:

| Module | Implemented behavior |
| --- | --- |
| `lib/server/persistence/contracts.ts` | Trusted-engine request type, owned validated snapshot, counts, accepted issue types, database-ready value/record plans, PREPARED result and safe PersistenceError codes |
| `lib/server/persistence/validate.ts` | Runtime preflight of unknown input; pinned schema/ruleset 0.1; accepted status/issue consistency; strict calendar dates and normalized UTC timestamps; decimal text; monetary/date basis constraints; provenance/candidate/summary consistency; transformations; latest same-dataset selection after all-result validation |
| `lib/server/persistence/map.ts` | `preparePersistencePlan` validates first and explicitly maps accepted records, nested ordered issues and transformations into an owned plan; no writes or database IDs |
| `tests/persistence/fixtures.ts`, `validate.test.ts`, `map.test.ts` | Synthetic unit tests and current synthetic handoff compatibility |
| `vitest.config.mts` | Adds persistence test discovery without changing ingestion discovery |

Request shape is `{ results: IngestionResult[] }`. `validatePersistenceRequest` returns accepted dataset snapshots and counts; `preparePersistencePlan` returns `{ kind: "PREPARED", batch, datasets }`. This is preparation, not a persisted receipt. Database-generated UUIDs, parent FKs, lifecycle transitions and context JSON are deliberately absent. Nested issues stay associated with their canonical record until a future writer obtains database UUIDs.

Phase 2A rejects an empty result collection and **all mixed producer batch IDs**, including a mixed ID on an earlier replaced result, with `MIXED_BATCH_IDS`. Valid same-ID results may contain several datasets. It checks every supplied result before selecting the latest result for each dataset ID. This is in-memory consolidation only; it provides no durable retry idempotency or economic deduplication. Broader batch partitioning remains OPEN.

Validation checks persistence-relevant result fields, processed statuses/provenance/issues, accepted candidate equality, source row coordinates and the five summary counts. It is not a full raw-export JSON schema, authentication check or proof that source bytes were genuinely processed. Genuine REJECTED evidence may appear in processed rows and counts, but never in normalized financial input or the output plan. All-rejected results may produce a zero-record plan; activation policy is not decided.

Money stays string/null throughout. Existing exact decimal subtraction is reused only to check the ledger invariant; it uses BigInt, never floating-point monetary conversion. Source monetary text is bounded by the existing engine's 128-character limit; derived net allows up to 260 characters to accommodate exact subtraction across different scales. No rounding, currency membership rule, conversion or new accounting eligibility rule is introduced. Malformed currencies and reviewed negative/dual-sided ledgers retain their accepted warnings.

Issue order, JSON null/booleans/strings/typed Excel original values, transformations, identifiers, dates and all lineage are preserved. Object key order does not affect equality. Source_row_id is used only to correlate evidence/lineage within a dataset, never as a database identity. Output uses fresh nested objects; caller input is not mutated. Errors expose only `INVALID_INPUT`, `UNSUPPORTED_VERSION` or `MIXED_BATCH_IDS` and fixed messages without source values or underlying exceptions.

The pure helpers live under `lib/server/` and are not imported by UI or ingestion barrels. They intentionally have no framework runtime guard/dependency because they contain no server resources and are tested as standalone pure functions. Phase 2B's actual database adapter/service must enforce the server-only module boundary; directory placement alone is not such enforcement.

### Verification

- Persistence suite: **83 passed**, including independent expectations for large/negative/zero money, nulls, leading zeros, warnings/order/JSON, transformations, nonmutation, provenance/count tampering, mixed batches and all 23 accepted current synthetic handoff records.
- Existing ingestion suite: **97 passed, 1 skipped, 1 failed**. The sole failure remains `tests/ingestion/handoff.test.ts:160`, comparing a CRLF checked-in evidence fixture to LF exporter output. No ingestion implementation, contract, fixture or test was changed.
- Full suite: **180 passed, 1 skipped, 1 failed**, with the same unrelated handoff byte-comparison failure.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed.
- Lint: `node node_modules/eslint/bin/eslint.js .` passed.
- Vitest required approved process permissions after initial sandbox `spawn EPERM`; no dependencies were installed. Tracked/untracked changes were reviewed and whitespace checked.

### NOT IMPLEMENTED YET / OPEN

No PostgreSQL driver, repository, database writes, transactions, Supabase connection, credentials, durable idempotency, public API, browser integration or authentication/authorization is implemented. No database/Supabase changes, commits or pushes were performed. Chia's implementation/contracts/tests remain untouched; `FYP-A-B` was never accessed or modified.

OPEN: durable request key/registry and replay/conflict semantics; batch scope beyond this conservative single-ID rule; final batch context; production writer role and deployment/pooling; authentication/tenancy; superseding/activation/reporting policies; source/rejected evidence retention. Preparation must not be treated as durable persistence.

Phase 2B should add the separately reviewed server-only database adapter/repository, a single-connection atomic writer and disposable local database integration tests for UUID/FK attachment, deferred warning checks, rollback and database errors. Resolve idempotency and commit-uncertainty policy before enabling retries; hosted connectivity and credentials require their own authorized scope. Public API/browser integration remains later work.

## Phase 2B / Phase 2C — IMPLEMENTED, 3 October 2026

See [Phase 2 internal persistence](phase-2-internal-persistence.md) for the server-only pg adapter, repository, atomic transaction writer, service contract, test results and read-only hosted metadata verification. Phase 2A validation/mapping is reused without changing Chia's contract.

The service requires `intent: NEW_ATTEMPT_NO_RETRY`; retry/idempotency contracts are explicitly unsupported. No durable duplicate guarantee, auto superseding or economic deduplication is implemented. All-rejected activation is conservatively unsupported by the writer pending team policy. API/browser integration, authentication/tenancy, final writer privileges and evidence retention remain OPEN.

Verification: 131 persistence tests passed (83 Phase 2A, 31 new unit, 17 local integration); full suite 228 passed, 1 skipped, and only the known ingestion CRLF/LF failure. TypeScript and lint passed. Personal hosted schema/RLS/grant metadata matched the normalized local baseline, with no hosted writes/schema/security changes or credential access. Remaining Phase 2 changes are uncommitted and unpushed for user review.
