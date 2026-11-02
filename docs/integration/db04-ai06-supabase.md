# DB04 / AI06: persistent synthetic cash reconciliation

Implemented on `feature/db04-ai06-supabase-celester`, from freshly fetched
`main` at `cb5db4625ceca1cb94867a90a8a3edddbcf1e6ba`. Integration base is `main`;
no backend, AI or UX branch was merged. No hosted database, authentication,
role, RLS, credential, Vercel configuration or Production demo was modified.

## Supported contract and reused code

This internal vertical slice accepts registered synthetic BANK / LEDGER CSV bytes.
It hashes owned copies of the actual bytes, checks the supported schema fields,
then calls the existing server `normalizeCashSource` and shared cash-source
normalizer/matcher in `lib/poc-reconciliation/engine.ts`. All records must pass
the source's date, MYR, bank-direction or cash-account debit/credit checks.
Unknown fields, opposite-role columns, unknown fingerprints, inconsistent scope,
missing amounts and invalid rows reject the entire document pair before any write.

The registration constructor is trusted server composition, never browser input.
Default registration reuses `approvedPoCSourceHashes`. Tests explicitly register
the two byte-pinned synthetic documents in `tests/reconciliation-persistence/fixtures/`,
transcribed from the repository's existing supplied PoC test row. There is no
runtime use of evaluation labels, `CategoryLabel` or `SourceTransactionID` as
matching evidence.

**This is `cash-source-v1`, not C1 or V2.** C1 projects VALID/WARNING from trusted
ingestion-engine results; V2 has different financial values and verification
semantics. The existing grouped C1 writer remains unchanged, including its
VALID/WARNING acceptance and rejected-row exclusion. Casting cash or V2 rows into
`IngestionResult[]` would invent ingestion provenance, conventions and approvals.
Consequently this slice uses additive typed cash tables, rather than writing
incompatible records to existing `public.financial_records`. Cash v1 currently
produces VALID records only; it does not manufacture C1 warnings. Invalid source
documents are rejected, not partially accepted or retained as financial records.

`lib/server/db/postgres.ts` supplies the actual transaction adapter. It retains
its safe errors, transaction limits and uncertain-commit handling. No automatic
transaction retries are introduced. Existing M2 organizations, users, memberships
and sessions and M3 organization state supply local ownership/authorization.

The AI branch at `425b28b` was inspected, including AI02 exact scoring, AI03 E5
runtime, AI04 financial/identity verification and AI05 frozen evaluation. AI04
source checks require its frozen template, split, period, account and synthetic
row-provenance registry; they are not document-ingestion validators. Its policy
also pins a two-day research window and cannot safely be relabeled as client
accounting approval. This increment reuses the already integrated cash matcher
and exact BigInt cents utilities rather than copying frozen research algorithms
or changing those contracts. The new verifier independently checks the proposal's
raw financial and identity evidence, without trusting matcher status.

## Schema and migrations

Review and apply **only to a new disposable local database**:

1. Existing `v2-verified-document-local.sql`, `v2-m2-local.sql`, `v2-m3-local.sql`.
2. New `db04-001-reconciliation.sql` (schema/data constraints).
3. New `db04-002-reconciliation-security.sql` (role, auth functions, RLS, immutability).

The native test additionally installs the existing C1 foundation, grouped upgrade
and DB02 fence to exercise coexistence. No service function installs migrations.
The migrations are one-time reviewed scripts, not idempotent reset commands.

All new tables live under `fingence_reconciliation`:

| Table | Purpose |
| --- | --- |
| documents | Immutable per-organization SHA256 identity and versioned registered classification |
| jobs | Content/policy/version-derived processing ID, owner, final processing status |
| job_sources | Exactly one source per role in a job; typed document FK |
| transactions | Accepted source records, exact numeric money and original decimal text, raw fields and CSV record number |
| proposals | One-to-one BANK/LEDGER FKs and algorithm version |
| decisions | Independent named verification checks, policy version and suggestion/unresolved outcome |
| cases | Unresolved/ambiguous/group evidence with reason codes |
| reviews | Append-only, version-checked human annotations; never financial clearance |
| audit | Atomic append-only persisted/read/reused/reviewed history |

Composite foreign keys bind tenant, processing ID, source fingerprint, role and
record identity. `numeric` has no rounding typmod; original source amount strings
are separately preserved and constrained to agree. Bank `ValueDate` is stored as
`value_date` with basis `VALUE_DATE`; ledger `PostingDate` retains `POSTING_DATE`.
Neither source provides a transaction date, so `transaction_date` stays NULL.
The canonical date never silently substitutes one date meaning for another.
NULL is never zero. No monetary
equality or total uses JavaScript floating point. Tests include
`9007199254740991.99`, beyond JavaScript's exact integer range.

## Service and verification

`createFinancialProcessingService(database, registeredPair?, policy?)` exposes
internal `persist`, `get` and `review` methods. `persist` takes a local session
token and two `{bytes, filename}` sources; it returns `{processingId, reused}`.
`get` returns job, classified sources, exact accepted transactions, proposals,
decisions, unresolved cases and review history under the same identity. All reads
are audited and data is delivered only after COMMIT acknowledgement.

The processing ID hashes the pipeline version, resolved organization, complete
versioned verification policy and role-bound source hashes. Same bytes/policy
reuse a stored job; filenames do not create new jobs. A new supported policy
creates a new processing context and reuses immutable documents. Older contexts
remain available explicitly by ID. There is no automatic “current” selection,
economic deduplication across changed files or supersession policy.

The existing matcher generates proposals, then independent verification checks
source identity, scope, exact signed amount, currency, accounting direction,
canonical date window, reference, counterparty and duplicate identity. Every
check must pass for `VERIFIED_SUGGESTION`; this is not a financial posting or
human approval. Failed checks retain their booleans as named reason evidence.
Duplicate/GROUP/PARTIAL cases stay unresolved. The schema also refuses a verified
decision missing any mandatory passing check.

The default policy is `synthetic-cash-same-day/1`. A separate explicit
`synthetic-cash-two-day/1` policy supports the research two-day window. Neither is
an approved SAIC accounting rule. The constructor accepts only these registered
policy/version pairs. Fuzzy/E5 proposal adapters are not wired and no live E5
inference ran. Frozen AI01–AI05 benchmarks, thresholds and evaluation artifacts
were not modified or regenerated.

All writes, including audit, share one READ COMMITTED transaction. A PostgreSQL
advisory transaction lock serializes identical processing requests; unique keys
remain the final constraint. Failure of the final audit write rolls back every
document/job/accepted row. Lost COMMIT acknowledgement preserves
`COMMIT_OUTCOME_UNKNOWN`, with no automatic retry. Investigate by the deterministic
processing ID using the same authoritative primary; absence during an in-flight
or uncertain operation is not proof of rollback.

## Security and deployment boundary

The new NOLOGIN runtime group has SELECT/INSERT and sequence usage only. Tests
connect as a separate LOGIN member with neither ownership, superuser nor
BYPASSRLS. All nine tables enable and force RLS. Tenant resolution uses a
transaction-local hash of the session token and SECURITY DEFINER functions with
pinned search paths and revoked PUBLIC execution. It does not trust a tenant GUC.
Session/membership/organization rows are locked for the transaction. Expiration,
revocation, membership version, Finance role, organization activation and optional
M5 account suspension are enforced. Runtime cannot read the session store.
Restrictive INSERT policies bind job/review/audit actors to the authenticated
session. Database triggers reject financial-evidence UPDATE/DELETE; runtime lacks
UPDATE/DELETE/TRUNCATE/DDL grants. Audit records contain IDs/actions only.

No new HTTP endpoint is exposed. Hosted deployment still needs Jason's reviewed
identity/session resolver, organization membership/revocation integration, an
approved separate nonproduction target, migration ownership and runtime grants,
protected denial/failure security auditing and operational retention controls.
The current auth adapter is deliberately the existing local M2/M3 system, not a
Production identity fallback. Invalid authentication and pre-write validation
failures return safe adapter errors; they do not create partial job/audit records.
No credentials or environment connection strings are loaded by the native tests.

## Reproduction and evidence

Use Node 24 and the lockfile dependencies. On Windows the native harness locates
`C:\Program Files\PostgreSQL\18\bin`; set `FINGENCE_TEST_PG_BIN` to another
installed native binary directory if needed. Each run creates a new temporary
cluster, binds a fresh loopback port, creates synthetic local sessions and a
restricted role, then stops and removes only its own verified temporary directory.
No hosted connection or existing PostgreSQL data directory is used.

```powershell
pnpm exec vitest run tests/reconciliation-persistence
pnpm exec vitest run tests/reconciliation-persistence tests/persistence tests/security tests/integration tests/ingestion tests/poc-reconciliation --maxWorkers=2
pnpm typecheck
pnpm lint
pnpm check:server-boundary
```

The native suite performs genuine PostgreSQL writes/reads, recreates the
connection pool/service, compares persisted records, tests concurrent duplicates,
rollback, exact decimals, FKs, classifications, RLS, missing/stale/expired/revoked
sessions, audit actor spoofing, append-only reviews and lost commit acknowledgement.
It skips explicitly if native binaries are unavailable; PGlite is not substituted
as native concurrency/RLS evidence.

Exact run counts, baseline comparison, file inventory and limitations are in
`db04-ai06-test-results.json`. Raw JSON reports are retained locally under
`outputs/db04-ai06/`; earlier failed runs are preserved, not overwritten as passes.
The full suite has existing Windows/environment failures; a passing focused
suite does not imply that the complete project passes on this host.
