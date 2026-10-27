# P2 local backend and security composition

This increment integrates internal server modules for local verification. It does not provide an authenticated HTTP API, production identity/membership, tenant ownership, hosted persistence, supersession, or a V2-to-C1 bridge. Apply the SQL only to a disposable local database until a separate hosted integration is authorized.

## Source provenance

- Base: `667f0cf7f8428485d995c2b2ca31823835d217e3`.
- Celester: `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca` — transaction/batch query modules, their tests, and DB02 warning-mutation fence and tests.
- Jason: `7868d6e0ac8d5358d285d577ac3113586642b7f4` — transaction guard/access, signed cursor, audit storage/API helpers, audit action vocabulary, and audit migrations.
- Chia: internal scoped-read composition, cursor-format adapter, cross-module tests, and documentation. Teammate branches were not merged or overwritten.

Celester's DB03 recovery work is a separate local evidence set and is not transferred here. Its reported Windows native PostgreSQL results are not P2 execution evidence.

## Internal interface

`createScopedReadService` in `lib/server/integration/scoped-queries.ts` requires all of:

- A non-leased read executor that releases each query before returning, and a transactional audit database.
- `resolvePrincipal(request)`, which must verify the actual session/token **and active organization membership**.
- `resolveAccess(principal, request)`, which must load the current permitted batch IDs and scope version from trusted backend data.
- `resolveTransactionScope(principal, id)`, which must retrieve scoped resource metadata and any verified administrator exception, without returning financial contents.
- A server-side cursor signing secret of at least 32 bytes, supplied by the caller. No key is generated or configured here.

The returned `listTransactions(params, request)`, `getTransaction(id, request)` and `getBatch(id, request)` methods run Jason's guard, Celester's scoped query and the required durable audit gate. There is deliberately no batch-list method: a batch-list permission and audit contract have not been agreed. Record-specific role/scope denials and missing records return the same `404 RESOURCE_NOT_FOUND` from the facade. Guard denial audits are not repeated by query handling.

The selected query DTO is a reduced read view, not a reconstructed C1 payload. In particular it does not return all warning details, transformations, source filenames, worksheets or row coordinates. Those remain available in the stored records/evidence, subject to a future authorized read contract.

`query-cursors.ts` wraps Jason's HMAC token in strict canonical base64url for Celester's 512-character query grammar. The signature binds principal, organization, role, scope version, batch scope, endpoint collection, filters and page size. Invalid, expired, oversized and noncanonical tokens fail; no token is truncated or automatically retried.

Success data is returned only after the audit transaction acknowledges commit. Denied and failed operations produce allowlisted audit records containing identifiers and action/outcome metadata, never financial values, file contents, tokens or raw SQL errors. A failed or uncertain audit acknowledgement blocks data delivery; it is not retried. Transaction-list errors before the query audit callback are audited once by the facade. Batch/detail outcomes are audited by their query callbacks; guard denials are audited by the guard.

## Persistence and financial limits

The existing grouped service accepts **trusted engine-produced `IngestionResult[]`**, not external C1 JSON or experimental V2 output. It creates one backend attempt, one child per dataset and one database transaction. `VALID` and `WARNING` are persisted; rejected records remain outside financial records. `COMPLETED_EMPTY` children retain zero-accepted metadata. An unknown commit requires investigation against the same authoritative primary; do not automatically retry.

C2 creates fresh ingestion context for each run. A later grouped attempt remains separate; P2 does not choose a logical replacement key or mark the prior attempt superseded. A caller must not combine multiple attempts as if they were one current dataset without an approved lifecycle policy.

The existing SQL stores monetary values as PostgreSQL `numeric` and the query casts them to decimal text, without floating-point arithmetic. Canonical ingestion normalizes representation (including trailing zeros and negative zero) before persistence; this is not a byte-preserving copy of original cells. The scoped query does not infer bank polarity, ledger classification, revenue or cash flow.

## Local database verification

Test both (a) `phase1-clean-setup.sql` and (b) the historical Phase 1 fixture followed by `phase1-source-file-upgrade.sql`; then apply, in order, `c3b1-grouped-persistence-upgrade.sql`, `db02-001-warning-mutation-fence.sql`, `phase3-security-audit-upgrade.sql`, and `phase3-security-audit-api-events.sql` to each disposable database.

PGlite tests exercise SQL, the existing `pg` adapter, one-connection pool behavior, restricted client roles and the synthetic 26-row producer. A test-only restricted server role with `BYPASSRLS` demonstrates the DB02 trigger's needed `ingestion_status` update privilege, source-file validation-function execution, and related read/locking privileges. This is not a production role, RLS design or grant recommendation. Real service roles, grants, RLS and the audit table/sequence privileges require a separate reviewed production design.

PGlite is not evidence for native PostgreSQL concurrency, backup or recovery behavior. The existing native grouped test harness is Windows-specific; report skips when suitable native binaries are not present. Never point these tests at Supabase or another existing database.

## Remaining integration work

- **Celester:** persist organization/owner associations atomically with grouped attempts; define lifecycle and scope-version behavior and a safe explicit supersession contract.
- **Jason:** implement verified authentication, active membership, trusted ownership/exception resolution, batch-list permission, and protected production audit operation. Define revocation/transaction consistency at the real authorization boundary.
- **Chia:** preserve C1/C2 and do not cast V2 results into trusted ingestion output; adapt to agreed backend contracts in a separate increment.
- **Frederick and Izzat:** agree an authorized retrieval DTO for analytics/reporting, including any warning and provenance fields the current query projection omits.

The test fixture's synthetic sessions, memberships and ownership tables are confined to `tests/integration/`; they are not a runtime authentication fallback. No financial route is exposed by this increment.
