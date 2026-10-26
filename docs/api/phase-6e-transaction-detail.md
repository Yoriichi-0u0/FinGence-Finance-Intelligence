# Phase 6E transaction detail / Phase 6F regression improvements

26 October 2026. Branch `feature/backend-api-celester`, base `2ba10d695fbba4e9d43e3d14254c26525c5770fc`. The lecturer demo is preserved as a separate logical change. Internal services only; no HTTP handlers, hosted access, migrations, security-policy changes or ingestion/analytics changes. Following review, the user authorized separate demo and Phase 6E/F commits and a feature-branch push to preserve completed work. Further API development is [temporarily paused](phase-7-dashboard-feasibility.md#development-pause--26-october-2026).

## Internal detail operation

`createTransactionDetailQueryService(dependencies).get(transactionId, context)` in `lib/server/api/transaction-detail-query.ts` returns the existing `TransactionListItem` or `null`. `parseTransactionId` in the existing contract validates a database UUID selector and normalizes its case; validation does not authorize it.

Both list and detail use the same `TRANSACTION_ROW_SELECTION` in `transaction-selection.ts` and `projectTransactionRow`. This extracts the existing list projection without changing its SQL expressions or DTO semantics. Dates use DateStyle-independent ISO output, money uses PostgreSQL NUMERIC text, and NULLs, source-row/producer lineage, original monetary basis and direction remain unchanged. PostgreSQL normalizes some lexical representations, including negative-zero signs; mocked string-preservation tests do not claim database NUMERIC retains those signs.

The detail SQL uses fixed explicit columns and binds both UUID and server-resolved batch scope:

```sql
WHERE r.id = $1::uuid
  AND r.batch_id = ANY($2::uuid[])
  AND r.ingestion_status IN ('VALID', 'WARNING')
```

The current primary key permits at most one row. A bounded `LIMIT 2` plus runtime checks reject a broken database adapter returning multiple rows, a different UUID, invalid projected values, REJECTED data or an out-of-scope batch. An empty authorized scope returns `null` without querying. There is no unscoped existence lookup, no raw/rejected evidence selection and no acceptance inferred from a UUID or client organization/batch field. Stored batch lifecycle visibility remains the trusted resolver's responsibility, as with the list API.

For a caller whose lookup operation is authorized, nonexistent and out-of-scope transaction IDs both produce a scoped zero-row result, internal `null`, and `not_found` audit outcome. This guarantees response/semantic equivalence, not constant-time behavior. Global identity/operation denial is a distinct `ACCESS_DENIED` error and must not be fabricated as resource ownership.

The trusted resolver must preserve this distinction: reserve null for identity/operation denial; for a missing or out-of-scope target return an otherwise authorized scope excluding it (possibly empty). It must not encode target existence in different operation-denial responses. The service never performs an unscoped existence probe; future real adapters must be tested for this requirement too.

## Mandatory dependencies and failure behavior

- `database`: injected existing `SqlConnection`; no pool, credentials or environment loading occurs in the service.
- `resolveAccess(context, transactionId)`: Jason-reviewed adapter verifies identity, detail-read permission and stored ownership for the requested selector, then returns a trusted subject/organization/scope-version/batch scope or null. The selector is not proof. The grant shares only the shape of `TransactionAccess`; it does not inherit collection permission or extend record-specific grants to other records. The adapter must resolve trusted ownership rather than echo caller data.
- `audit(receipt)`: acknowledge literal `true` only after durable protected persistence. The bounded receipt contains verified actor/organization when available, requested UUID, outcome and count, never records/amounts/free text/tokens/raw exceptions. Jason must review its mapping to real events and request correlation; no audit infrastructure is implemented.

Every post-validation outcome (success, not-found, resolver denial, resolver/database/projection failure) attempts audit acknowledgement before being released. Audit rejection, false or missing acknowledgement raises `AUDIT_FAILED` and withholds the result/error. Missing adapters fail closed as `SECURITY_UNAVAILABLE`; invalid UUIDs and missing dependencies fail before audit and require future request-boundary logging. Errors expose only bounded codes and generic text. No retries occur. Grant structure validation is not authentication, and a no-op audit function cannot prove persistence.

A single-record lookup has no pagination/cursor input, so its dependency interface has no cursor codec. The existing transaction and batch list cursor requirements are unchanged and remain mandatory even on first pages. Production cursor security is still Jason's responsibility.

## Proposed HTTP contract — not implemented

Future `GET /api/v1/transactions/{transaction_id}` would call this service through verified identity/ownership and durable audit composition, return the allowlisted DTO for an authorized record, and use the same sanitized 404 for missing/out-of-scope records. UUID-validation errors, authentication/operation denial and dependency failures need reviewed HTTP mappings (for example 400, 401/403, and sanitized 5xx), private/no-store caching and request correlation before implementation. No public route, HTTP status handling or real security adapter is added here.

## Phase 6F work using confirmed existing contracts

Added database regressions for all three previously documented batch gaps:

1. An exact-full final page ends with `nextCursor: null`; no extra cursor is issued.
2. Combined status and persistence-attempt filters apply across multiple pages. Additional ACTIVE fixtures come from the real grouped writer inside a rolled-back local transaction, not fabricated production statuses/counts.
3. Timestamp/UUID keyset traversal remains correct under `SQL, DMY` and `Asia/Singapore`, retaining microseconds and equal-timestamp UUID ties.

Transaction-list regressions additionally cover combined date/status/currency/monetary-basis filters across an exact-full terminal page, individually missing cursor methods, and preservation of supplied negative-zero text. No analytics formula, policy, ledger interpretation, lifecycle transition or producer contract is changed.

The existing transaction-list service's denial/failure audit coverage is still narrower than batch/detail, as documented in Phase 6B. A compatible extension needs reviewed event/adapter semantics with Jason; it is not silently changed here or confused with the new detail interface.

## Tests and verification

`transaction-detail-query.test.ts` exercises request selectors, mandatory dependencies, exact DTOs, VALID/WARNING, NULLs/negative-zero text, scope/UUID mismatch, malformed/multiple rows, sanitized errors, empty/missing results, and awaited audit for all outcomes. Existing transaction database integration tests now run detail reads through `pg` against the actual schema in disposable PostgreSQL/WASM, including exact list/detail DTO equality, scoped absence, refreshed/revoked scope, all monetary bases and DateStyle/timezone/nullable dates.

Final verification: **255 API tests passed**; full project suite **676 passed, 1 optional supplied-workbook skip**, across 37 passing files and one skipped file. TypeScript, lint (no warnings), server-boundary and Git diff/whitespace checks passed. New modules participate in the server-only boundary guard. The three existing lecturer-demo files retain their original SHA-256 hashes; both output modes passed separately after the shared projection extraction (normal mode remains 26 lines).

Phase 6E/F changes are limited to these 13 files; the three pre-existing demo files are preserved in a separate logical commit:

- `lib/server/api/transaction-contract.ts`, `transaction-query.ts`, `transaction-selection.ts`, `transaction-detail-query.ts`
- `tests/api/transaction-detail-query.test.ts`, `transaction-query.test.ts`, `transaction-query.integration.test.ts`, `batch-query.integration.test.ts`
- `scripts/verify-server-boundary.mjs`
- `docs/api/phase-6b-transaction-query.md`, `phase-6c-batch-query.md`, `phase-6e-transaction-detail.md`, `phase-7-dashboard-feasibility.md`

See [Phase 7 feasibility and next-API dependencies](phase-7-dashboard-feasibility.md) for the stopping point after independently defined work.
