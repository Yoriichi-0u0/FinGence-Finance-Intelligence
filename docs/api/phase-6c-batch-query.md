# Phase 6C — Internal batch API foundation

Forward planning: [Phase 6D-A V2 ingestion readiness](phase-6d-a-v2-ingestion-readiness.md) assesses reuse and schema gaps for Chia's pending replacement contract. This batch foundation remains the existing stored-data boundary; it does not define V2 decisions or ingestion payloads.

25 October 2026. Branch `feature/backend-api-celester`, starting at `86ba45ee025db5736c05af63005a93f60f7d3fee`. Internal only: no route, production security adapter, schema change, hosted access or deployment. Jason's security modules and Chia's ingestion implementation are unchanged.

## Verified schema and persistence behavior

Sources: `supabase/sql/phase1-clean-setup.sql`, `phase1-source-file-upgrade.sql` (alternative upgrade path, not applied on top of clean setup), `c3b1-grouped-persistence-upgrade.sql`, and the existing persistence repository/grouped service. Integration tests inspect actual `information_schema.columns` and `pg_constraint` after creating the current schema in disposable PostgreSQL/WASM storage.

| Stored table | Actual supported information | Limits |
| --- | --- | --- |
| `ingestion_batches` | UUID `id`; nonunique producer `ingestion_batch_id`; status; timestamptz `created_at`, nullable `completed_at`; integer received/valid/warning/rejected counts; nullable parent attempt UUID and dataset identity | No authenticated actor or organization ownership; context and filenames are sensitive; historical parent/dataset links may be NULL |
| `validation_issues` | FK `financial_record_id`; warning severity; technical/business category; ordered issues | No batch FK. Must join through `financial_records.batch_id`. Messages, rule/field/source-column names and original values are not safe ordinary response data |
| `persistence_attempts` | UUID `id`, positive `dataset_count`, creation timestamp | No processing status, actor, organization, progress, error detail or durable failure registry. Parent attempt identity is not an ingestion batch identity |

The writer persists accepted VALID/WARNING financial records and their warnings. REJECTED rows contribute stored counts but are not persisted as retrievable evidence. An all-rejected grouped dataset completes as `COMPLETED_EMPTY` with zero accepted records; zero received rows are not implied. Grouped writes commit all parent/children atomically; an in-flight or rolled-back attempt may have no visible rows. Do not treat absence as proof of failed/not-committed persistence: investigation is a separate existing protected operation.

## Contract and projection

`lib/server/api/batch-contract.ts` defines strict request parsing, UUID/timestamp validation and `projectBatchRow`. List parameters are `limit` (default 25, range 1–100), opaque `cursor` (bounded base64url syntax), exact `status`, and UUID `persistence_attempt_id`. Unknown/duplicate/empty/invalid parameters fail validation. Lookup takes a database batch UUID, never a producer identifier or parent-attempt identifier.

Response fields are explicitly allowlisted: `batch_id`, `ingestion_batch_id`, nullable `persistence_attempt_id`, stored `status`, UTC timestamps, stored `rows_received`, `valid_count`, `warning_count`, `rejected_count`, derived `accepted_count = valid_count + warning_count`, and `validation_summary`. The summary contains only `total_warning_issues`, `technical_warning_issues`, `business_warning_issues`. Counts refer to stored ingestion/persistence facts, not unique economic transactions, reconciliation or model eligibility. Issue counts count issue rows; one WARNING record can have multiple issues. They do not summarize rejected validation failures.

No filenames, dataset identities, context, source values, descriptions, amounts, raw financial records, rejected evidence, warning text, internal exceptions or sibling-attempt counts are returned. The parent UUID is correlation only and grants no attempt access. Other relationships (including supersedes links) are deliberately omitted. No aggregate attempt status or progress percentage is manufactured.

All five actual statuses remain distinct: PROCESSING, ACTIVE, SUPERSEDED, FAILED, COMPLETED_EMPTY. ACTIVE describes completed accepted-row persistence, not accounting accuracy or permission to analyze. The contract does not infer lifecycle transitions or reinterpret FAILED. PROCESSING/FAILED/SUPERSEDED visibility depends on the eventual trusted scope policy; it is not implemented by the service. Stored counts are not silently replaced by a fresh record recount. Legacy NULL parent/completion fields remain NULL; missing required columns fail projection rather than masquerading as historical NULLs. Aggregate SQL bigint text is converted only to validated nonnegative safe-integer counts; overflow fails closed.

## Query service

`createBatchQueryService(dependencies)` in `lib/server/api/batch-query.ts` exposes:

- `list(URLSearchParams, context)` → immutable `{ items, nextCursor }`.
- `get(batchId, context)` → immutable batch DTO or `null`. A missing authorized row and an out-of-scope row both return `null`; no unscoped existence probe occurs. Missing identity/permission fails the operation rather than returning a permission grant.

Every SQL value is parameterized. Identifiers/projection/ordering are fixed constants. Every data query contains `id = ANY($1::uuid[])`; filters only narrow a server-resolved batch scope. Attempt filtering never expands access to siblings. A CTE selects at most `limit + 1` scoped batches before category-only issue aggregation via the real issue → accepted record → batch relationship. Counts come from the same SQL statement snapshot. No query loads rejected rows, issue payloads or ingestion context into application memory.

Ordering is native `created_at DESC, id DESC` with strict tuple keyset continuation. PostgreSQL timestamptz microseconds are serialized directly as UTC `YYYY-MM-DDTHH:MM:SS.USZ` using `AT TIME ZONE 'UTC'` and `to_char`, independent of session DateStyle/timezone. Cursor anchors preserve all six fractional digits; JavaScript Date is used only for validation, never to regenerate cursor timestamps. Native timestamp comparisons remain in SQL. All lookahead rows are validated, and a cursor is issued from the last returned row only when another exists. This is not a multi-request frozen snapshot; concurrent changes require agreed consistency policy.

## Mandatory trusted adapters — Jason/backend integration

No authentication, roles, membership tables, ownership policy, cursor crypto or audit infrastructure is invented. No default permissive implementation exists. Server composition must provide:

1. `resolveAccess(context, operation)` verifies identity, active membership, explicit batch-list/lookup authorization and stored ownership, returning subject, organization, scope version and the permitted database batch UUIDs. `list`/`lookup` are internal adapter operation tags, not changes to Jason's enums. A client UUID, organization header, role claim or producer/attempt ID is not authority. Null denies; malformed/throwing scopes fail closed. Scope is copied/frozen and refreshed on every call. Whole-batch access is assumed; partial-record access needs a reviewed design.
2. `cursors.verify/issue` must enforce integrity, expiry, collection domain (`ingestion_batches`), subject, organization, scope version/batch set and all filters including limit. Valid token syntax or a well-formed position is not proof of authenticity. Tests use only an in-memory synthetic registry.
3. `audit(receipt)` must map minimal operation/outcome/result-count receipts to security-approved events and await protected durable persistence, then acknowledge literal `true`. Success, not-found, resolver denial and service failure after request validation all pass this gate; a failed audit withholds data/errors as `AUDIT_FAILED`. Receipts contain no batch payloads, cursor, query text, filters, tokens or exception text. Request correlation and richer trusted actor attribution on failed resolution must be supplied by reviewed adapter composition. Invalid request parsing and wholly missing dependencies fail before this gate; future transport/security composition must handle those events. The service cannot prove a no-op adapter persisted anything.

There is no organization column or ownership mapping in the current schema. The allowlisted UUID scope is a dependency seam, not per-organization RLS or proof of provenance. Historical unmapped data must not be granted automatically. Real membership, ownership freshness/revocation races, collection/lookup role policy, lifecycle population, durable audit semantics and real signed/expiring cursors remain blockers before route integration. No Admin/Reviewer access rule is added here. Parent attempts require independent permissions; batch access never authorizes `investigateAttempt`.

## Tests and verification

New tests: `batch-contract.test.ts`, `batch-query.test.ts`, `batch-query.integration.test.ts`, with shared synthetic `batch.fixtures.ts`. Disposable tests use the real schema and existing grouped writer through the actual `pg` driver on an ephemeral loopback socket; no developer `.env` or hosted connection is loaded.

Coverage includes request bounds/allowlists, UUIDs, statuses, count consistency, all-rejected completion, NULL/missing metadata, metadata/FK inspection, multiple issue categories, sensitive-field suppression, missing/unscoped IDs, empty scope/results, status/attempt filtering, parameterization, equal timestamp UUID ties, microsecond continuation, DateStyle/timezone independence, cursor binding/replay, revoked access, projection/SQL/cursor errors and mandatory audit acknowledgement.

```powershell
corepack pnpm exec vitest run tests/api
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm check:server-boundary
git diff --check
```

Final verification: **105 new batch tests passed**; all API tests **205 passed**; full suite **625 passed, 1 skipped** (optional supplied workbook), across 35 passing test files and one skipped file. TypeScript, lint (no warnings), server-boundary verification and Git diff/whitespace checks (including new files) passed. Both new server modules are included in the boundary guard script. Final engineering review found no blocking correctness or security-boundary defects; the user subsequently authorized committing and pushing this internal foundation to the feature branch. Production security integration and route activation remain blocked on the requirements above.

Nonblocking regression-test follow-ups: explicitly test an exact-full final page, combined status/attempt filtering across pages, and keyset pagination under an altered session timezone. These are recorded for later development, not included as code changes in this commit.
