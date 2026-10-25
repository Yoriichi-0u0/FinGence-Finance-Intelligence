# Phase 6B — Internal transaction query service

23 October 2026. Starting commit: `e72ef19d5f4367d7b66a7e396fef1485397e7e6d` on `feature/backend-api-celester`.

## Scope

Follow-on: [Phase 6C batch API foundation](phase-6c-batch-query.md) adds a separate internal batch contract/query service. It does not grant access to transaction or persistence-attempt operations.

`lib/server/api/transaction-query.ts` exports `createTransactionQueryService(dependencies).list(parameters, context)`. This is an internal server-only service, with no HTTP route, default security implementation, pool construction, environment loading or hosted database access. Jason's authorization/audit modules are unchanged. The service returns an immutable `{ items, nextCursor }` page using the existing explicit DTO.

Database access uses the existing `SqlConnection` interface. The service issues one SELECT per nonempty authorized scope, binds every filter/scope/cursor/limit value as a SQL parameter, explicitly restricts status to VALID/WARNING, and never selects raw evidence, filenames, batch context or arbitrary columns. The three date columns use `to_char(column, 'YYYY-MM-DD')` for deterministic ISO output; NUMERIC columns use `::text`. DTO projection preserves PostgreSQL decimal strings, NULLs, source-row/producer-batch lineage, separate source dates, warning currencies and monetary direction without recomputing amounts or inventing totals. PostgreSQL itself may normalize numeric representations on storage; this service preserves the text returned by PostgreSQL.

## Required trusted adapters

All dependencies are mandatory at runtime. Missing/malformed/throwing security dependencies fail closed; no fallback grants or unscoped queries exist.

- `resolveAccess(context)` must verify identity, active organization membership and explicit collection-read permission, then resolve stored batch ownership and the permitted lifecycle/reporting population. Return `null` for denial or a server-derived subject, organization, scope version and complete permitted batch UUID list. No client role/organization/batch list is accepted as proof. The adapter is a proposed integration seam, not an authentication/ownership policy or signed capability. Its implementation and caller composition require Jason's review. It must audit its own access decisions through a protected sink.
- `cursors.verify/issue` must enforce token integrity, expiry and binding to the full supplied identity, organization, scope version, batch scope and filters (including limit). The service validates returned date/UUID positions and token syntax, but cannot prove that an injected verifier actually checked a signature. There is no production cursor codec. Tests use a synthetic in-memory registry solely to exercise the binding interface.
- `auditRead(event)` must persist the agreed protected collection-read event and resolve to literal `true` only after durable acknowledgement. It receives subject, organization and returned count, not records, cursor, filters, credentials or SQL errors. The adapter must map this provisional receipt to security-approved action/target and request correlation semantics. Throwing or failing to acknowledge prevents the page from being returned, including empty pages.

The service snapshots and freezes grants/filters before later awaits, re-resolves access on every page, normalizes only UUID spelling for scope comparison, and treats a request batch UUID solely as a narrowing filter. A batch outside the authorized set is denied before querying. An empty authorized set returns an audited empty page without touching financial storage. The query always contains `batch_id = ANY($1::uuid[])`; no guessed organization column or schema migration is introduced. This seam assumes whole-batch scope; partial-record permissions would require a separately reviewed design.

## Pagination and failures

Ordering is `canonical_date DESC, id DESC`. Continuation uses the strict tuple predicate `(canonical_date, id) < (last_date, last_id)` and fetches `limit + 1` rows. All fetched rows, including lookahead, are projected/validated before release. A next cursor is issued from the last returned row only when another row exists. Equal-date UUID ties are deterministic; no offset pagination is used.

Separate pages are separate reads, not a frozen database snapshot. Newer inserts do not shift the continuation boundary, but backdated inserts, deletions or changes to dates/ownership can change later pages. Production integration must agree immutability, scope freshness/revocation and snapshot requirements. The trusted resolver must supply a current consistent scope; a list of UUIDs alone cannot solve ownership changes racing a read. No ACTIVE/SUPERSEDED policy is silently imposed by this service.

Invalid request filters retain `InvalidTransactionContractError`. Service failures expose only bounded codes (`SECURITY_UNAVAILABLE`, `ACCESS_DENIED`, `INVALID_CURSOR`, `QUERY_FAILED`, `AUDIT_FAILED`) and generic text. Raw dependency errors and partial pages are withheld; no retries occur. Security-approved denial/failure event handling for service-level failures, request correlation, cancellation, rate limits and HTTP error/cache mapping remain integration work. There is no claim of a complete production audit system.

## Local verification

Synthetic tests cover parameterized SQL, all filters and combinations, inclusive dates, empty results, equal-date pagination, multiple batches, exact large decimals and scale, NULLs, WARNING acceptance, malformed-but-accepted currency preservation, source lineage, direction, schema REJECTED exclusion, projected-output validation, missing/malformed/denied security context, cross-scope batches, cursor replay/tampering/revocation and audit/database/cursor failures. Audit acknowledgement is explicitly awaited before returning data.

`transaction-query.integration.test.ts` creates fresh PostgreSQL/WASM storage, loads both existing schema scripts there, and uses `pg` through an ephemeral loopback socket. No developer environment or hosted database is used. Constraint-error tests explicitly roll back their local transaction. No dependency or schema files changed.

```powershell
corepack pnpm exec vitest run tests/api
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm check:server-boundary
```

Initial local verification: API tests **99 passed** (45 contract, 54 query-service); full suite **519 passed, 1 skipped** (optional supplied workbook), across 32 passing test files and one skipped file. TypeScript, lint (no warnings), server-boundary verification and `git diff --check` all passed. The boundary script now also checks the query service's `server-only` guard.

## 24 October 2026 — DateStyle correction

The review reproduced a valid date being returned as `03/09/2026` by `date::text` under `SQL, DMY`, causing DTO validation to fail. Only date output expressions now use `to_char(..., 'YYYY-MM-DD')` for `canonical_date`, `transaction_date` and `posting_date`. NULL dates remain NULL. All date predicates, tuple comparisons and ordering continue to use native PostgreSQL dates; money serialization and financial semantics are unchanged.

The new disposable-database regression failed before the fix and passed afterward. It uses one checked-out connection and a rolled-back transaction to compare complete filtered keyset pages under `SET DateStyle TO 'ISO, MDY'` and `SET DateStyle TO 'SQL, DMY'`. A control query proves raw date text actually changed. Assertions cover identical records and amounts, equal-date UUID ordering, all three ISO date fields, a NULL transaction date, a NULL posting date and the POSTING_DATE basis. Rollback restores fixtures and session settings. SQL-shape assertions also confirm native date predicates remain intact.

Verification after the fix: **100 API tests passed** (45 contract, 55 query-service); full suite **520 passed, 1 skipped** (optional supplied workbook). TypeScript, lint (no warnings), server-boundary verification and `git diff --check` passed. No production security adapter, denial/failure audit integration or public endpoint was added.

## Remaining activation gates

Jason/backend must agree and implement trusted identity/membership, explicit collection permission (no routine Admin/Reviewer raw-record access), durable organization/ownership mapping including historical unmapped rows, a safe lifecycle population, production cursor security and protected durable audit semantics. Unmapped rows must not be granted through a caller-supplied batch ID. Existing record-specific admin exceptions cannot authorize arbitrary listing. Before any route, add integration tests against those real security adapters, including wrong-role and revoked-membership scenarios. Any hosted migration needs separate approval. No endpoint, push, deployment or main merge is part of this change.
