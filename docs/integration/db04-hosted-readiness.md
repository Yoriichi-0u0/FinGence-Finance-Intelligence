# Controlled hosted readiness procedure

Starting HEAD: 73d5d15c6cc379228833d557e53dd5bd002b4798.
This task authorizes local implementation/testing only. FYP A project reference,
hosted schema and hosted identity are unverified. No hosted connection, migration,
financial write, role/auth change, backup operation or paid branching was executed.

## Executable entry points

From the repository root with the existing Node 24 dependencies:

```powershell
node --conditions=react-server scripts/db04-readiness.mjs plan
node --conditions=react-server scripts/db04-readiness.mjs inspect
```

`plan` never connects. It emits ordered filenames and SHA256 of the exact local
SQL bytes. Review/save that manifest privately before any separately authorized
deployment; repeat it on the exact checkout used for execution. `inspect` requires
a dedicated DB04_INSPECTION_DATABASE_URL; it never falls back to the application
SUPABASE_DATABASE_URL and never reads an .env file automatically. Missing/unsafe
configuration produces a safe BLOCKED code and exit status 2. Raw errors, passwords
and connection strings are never printed. There is intentionally no `apply` mode.

### Future explicitly approved read-only FYP A inspection

1. Owner verifies the exact FYP A project reference in the dashboard and explicitly
   authorizes catalog-only inspection. A configured variable is not independent
   proof of approval or project name. Record that approval outside source control.
2. Arrange an existing dedicated inspection login with CONNECT and normal system
   catalog access, no superuser/BYPASSRLS/role/database creation, no privileged
   memberships or mutation privileges on the approved M2/M3/DB04/C1 tables. The
   native test proves private-schema USAGE and financial SELECT grants are not
   required. Do not create/grant a hosted identity during this task.
3. Configure secrets privately, never in chat, Git, command arguments or NEXT_PUBLIC:
   DB04_INSPECTION_DATABASE_URL and, only if needed, DB04_INSPECTION_CA_CERT.
   Configure nonsecret expected identity as DB04_INSPECTION_ROLE and
   DB04_INSPECTION_DATABASE. For hosted inspection also require
   DB04_INSPECTION_PROJECT_NAME="FYP A", DB04_INSPECTION_PROJECT_REF=<verified ref>
   and DB04_HOSTED_INSPECTION_AUTHORIZATION="FYP_A_READ_ONLY" after actual approval.
4. Run `inspect`. Direct host must be exactly db.<ref>.supabase.co:5432 with verified
   TLS and the declared database/login. Pooler aliases are deliberately unsupported
   until independently bound to a reviewed project/role. Never disable certificates.
5. The first read-only transaction checks actual identity and privileges before
   protected-schema resolution. A second read-only transaction reads only catalog
   metadata, rechecks identity/permissions and returns diagnostics. It does not
   call tenant-resolution functions, SELECT financial rows or execute DDL/DML.
6. Inspect blockers and compare metadata against the reviewed migration manifest.
   A successful inspection never authorizes migration or proves hosted Auth/RLS.
   Preserve the result privately; do not publish operational metadata blindly.

The adapter retains existing pg verified-TLS handling, pool limits, cleanup and
no-retry uncertain-commit semantics. A read-only transaction is mandatory even
for a dedicated login. The CLI rejects known privileged usernames and the service
checks actual role flags, memberships and effective scoped mutation privileges.

## Verified local dependencies and exact order

DB04 depends on M2 organizations/users/memberships/sessions and M3 organization
activation. Key identity fields/types are checked against actual pg_catalog rows:
UUID subject/org keys; Finance role text; active/version; token_hash, expires_at,
revoked and membership_version; and organization active state. Optional M5
account_suspensions is consulted by the existing definer when installed.

Local dependency plan, emitted with checksums by `plan`:
1. v2-verified-document-local.sql (needed by the existing M2 package FK).
2. v2-m2-local.sql.
3. v2-m3-local.sql.
4. db04-001-reconciliation.sql.
5. db04-002-reconciliation-security.sql.
6. db04-003-ranking-evidence.sql.
7. db04-004-proposal-verification.sql.

The native coexistence suite additionally installs the existing C1 Phase 1,
grouped-persistence and DB02 integrity fence first. It tests actual constraints,
exact values, duplicates, rollback/uncertain commits, immutable audit, RLS,
independent AI evidence and report retrieval. Existing DB01–DB03 hosted state
cannot be inferred from those local results. No historical migration changed.

DB04 uses PostgreSQL numeric, SQL/PLpgSQL, JSONB/JSONPath, identity sequences and
advisory locks. No extra extension installation appears in its four migrations.
Inspect actual server version/extensions; native tests use PostgreSQL 18.6 and
do not establish Supabase-specific compatibility or managed-role permissions.

Catalog diagnostics include column types, constraints/validation, indexes,
triggers, forced/enabled RLS, policies, function owners/search paths/PUBLIC ACLs,
runtime-role flags/grants, and existing C1 column metadata. Using pg_attribute
instead of information_schema avoids false missing-column reports for a
catalog-only identity. This is a readiness diagnostic, not an exhaustive schema
equivalence or authentication proof.

## Authentication blocker and future deployment stop gates

Current M2/M3 identity is a local opaque session token hashed in a transaction-local
setting, with active/versioned Finance membership and organization locking. It is
not a Supabase JWT: current principal() does not verify issuer/audience/signature
or map auth.users, auth.uid() or request.jwt.claims. Browser-provided roles/org IDs
must never supply those missing semantics. Existing financial routes remain local.

Jason/owner must supply reviewed subject mapping, organization membership and
Finance permissions, expiry/revocation/suspension semantics, transaction consistency,
definer ownership/runtime grants, and audit/retention requirements. The readiness
interface records these requirements and always blocks hosted deployment; it
does not implement or invent a hosted session fallback. See official references:
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database roles](https://supabase.com/docs/guides/database/postgres/roles).

Future migration execution requires a separate explicit authorization naming the
exact target and proposed changes, reviewed hosted identity migration, and a
verified backup plus restore drill to a disposable target. Preserve existing C1
data, constraints, policies, grants and object definitions before/after. Check the
actual project backup capability; do not assume PITR or enable a paid feature.
[Official backup guidance](https://supabase.com/docs/guides/platform/backups).

Only after those blockers are resolved may a future operator apply approved
additive scripts with a separate reviewed migrator. Do not automatically run the
local M2/M3 files on FYP A, replay clean-setup SQL on populated C1, disable RLS,
drop existing objects or perform destructive down-migrations. Partial schema,
checksum drift, unknown identity/grants, unsafe function ownership or unvalidated
constraints stop execution. An uncertain COMMIT stops retries and requires
investigation against the same primary.

Before any hosted release, repeat the native scenario against the approved target:
restricted-role synthetic BANK/LEDGER persistence/read, exact values/hashes/IDs,
reconnect and duplicate/concurrent requests, cross-organization denial, revoked/
expired/inactive identity denial, audit immutability and injected rollback. Owner
or service-role tests do not prove RLS. Record each migration checksum/outcome and
compare C1 preservation evidence. None of these hosted steps ran in this task.

## Local verification commands

```powershell
$env:DB04_E5_SMOKE='1'
pnpm exec vitest run tests/reconciliation-persistence tests/persistence tests/security tests/integration tests/ingestion tests/poc-reconciliation tests/poc-insights tests/poc-forecast --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm check:server-boundary
```

The inspector/CLI test creates a fresh native catalog-only login and confirms
financial SELECT denial, full metadata visibility, read-only transaction mode,
runtime-role rejection and remaining hosted blockers. Other existing tests
retain all five protected financial views and live Next HTTP compatibility.
Local execution is not hosted verification. Full-project baseline failures
remain disclosed; the complete project suite was not rerun.

Actual results: relevant regression run 688 passed, 0 failed, 14 existing skips;
final focused run 106 passed, 0 failed, 0 skipped, including 27 native PostgreSQL
tests. The broad run preceded final catalog-only CLI refinements; the focused
run verifies final source. Counts overlap. Final pnpm typecheck, pnpm lint and
pnpm check:server-boundary passed. Checksums/raw-report hashes and precise
limitations are in db04-hosted-readiness-evidence.json. A private CommonJS evidence
helper that caused the initial full lint failure was preserved under .local,
without changing application/lint configuration or historical measurement reports.
