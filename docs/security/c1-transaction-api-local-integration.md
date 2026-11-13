# C1 transaction API security integration

## What this adds

The transaction and batch read routes compose the existing `createScopedReadService()` with the M2 server-verified local session and the C1 database ownership table. The routes are local-development only: they require the M2 local flags, a loopback request, and a loopback PostgreSQL database. Hosted/production identity is not implemented or enabled by these routes.

The active M2 session resolver supplies user ID, organization ID, role, and membership version from the local session and membership rows. The adapter maps `Finance` to `Analyst`, `Admin` to `Admin`, and `Technical (Management)` to `Reviewer`. Existing policy then permits collection and batch reads for Finance Analysts; individual reads also require a permitted record and owned batch. No admin/reviewer collection read or reconciliation approval is introduced.

## C1 ownership at persistence

Apply `supabase/sql/phase3-security-transaction-ownership.sql` after the C1 schema and audit migrations. It creates `public.transaction_batch_ownership`, with one organization and owner per C1 batch. The table is server-only, has RLS enabled, and has no grants to browser roles.

`createGroupedPersistenceService().persistGroupedAttempt()` accepts an optional internal `TrustedPrincipal` as `ownership`. Only a trusted server call may populate it from the already-verified Finance session. Runtime validation requires the Finance Analyst policy role and UUID user/organization identifiers. When present, the owner row is written in the same database transaction as the batch. A failed owner insert rolls back the batch and records. Callers must never forward ownership fields from a browser payload. `resolveLocalC1BatchOwner(request)` is the local helper for obtaining this principal from a verified Finance session.

Legacy and previously persisted C1 batches have no owner row and are intentionally not exposed by these routes. The repo currently has no authenticated C1 ingestion route that passes ownership to grouped persistence, so new owned batches will become available when such a trusted server caller is connected. Do not backfill ownership by guessing from filenames, UUIDs, upload order, or request claims.

## Read routes and safeguards

- `GET /api/transactions` lists only batches with an ownership row for the verified active organization.
- `GET /api/transactions/[id]` resolves the record's batch/organization metadata before retrieving record content.
- `GET /api/batches/[id]` reads one authorized batch.
- Every allow, denial, query failure, and response is subject to the existing audit-before-return behavior. Audit failure withholds the response.
- Cursors require `SECURITY_CURSOR_SECRET` with at least 32 bytes and are bound to principal, ownership scope, filters, and page size.
- Route initialization also requires `SUPABASE_DATABASE_URL` to point to a loopback PostgreSQL host. This prevents the local-only routes from silently querying a hosted database.

Use the existing local M2/M3 launcher with `SUPABASE_DATABASE_URL` and `SECURITY_CURSOR_SECRET` set in the server process, and apply the listed SQL migrations to that loopback PostgreSQL database first. The launcher supplies the required local identity flags; do not manually enable these routes in a hosted or production process. The M2 account/session database remains the app's OS-local `.local/m2-database-v1` store.

The resolver fails closed when M2 session verification, ownership lookup, migrations, the audit store, the local database, or cursor-key configuration is unavailable. Responses do not include raw errors.

## Remaining boundary

This is a local integration, not a production authentication implementation. Production routes remain unavailable until the team adopts a verified production identity/membership provider, a production ownership mapping and persistence path, secret-manager configuration, and reviewed migrations. No hosted database or migration was contacted or changed by this work.
