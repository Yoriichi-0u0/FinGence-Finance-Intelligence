# Exact group DB01–DB04 / AI06 deployment review

3 November 2026, Asia/Singapore. Prepared for review only. No group connection,
deployment, backup export, financial write or hosted recovery was performed.

Target: **FinGence-Production**, project **zmtdozblpvtjniehwjrw**, database **postgres**.
The supplied catalog report says public has zero tables and reconciliation/M2/M3
are absent. That report was not independently reproduced in this worktree because
approved group credentials are unavailable. The SQL rejects drift from those assumptions.

## Exact SQL for owner approval

Run `node scripts/db04-group/verify.mjs` to verify source and artifact checksums without
connecting. The full SQL is committed, not hidden in a generated runtime statement.

| Sequence | File | SHA256 |
| --- | --- | --- |
| 1 | `supabase/sql/db04-group-review/install-review.sql` | `21ea11b4eaf63897e9379ee0cb6cefb3cc973662cdc65c733a3eb84ec60b6df9` |
| 2 | `supabase/sql/db04-group-review/synthetic-seed-review.sql` | `77ff0daa71cb64513d22b40244a6017081a821739905a5e466720d4148741e46` |
| 3 | `supabase/sql/db04-group-review/activate-logins-review.sql` | `f323717dbec88e6ef2ba2cc488a4ca9bac623919648c069d892fdc29ba56661e` |

Each file is its own explicit transaction. Stop at any error or unacknowledged COMMIT;
do not automatically retry. Installation/seed can already be committed if a later
transaction fails. Never infer rollback of earlier acknowledged transactions.

### Installation effects

Reuses main's `phase1-clean-setup.sql`, `c3b1-grouped-persistence-upgrade.sql` and
`db02-001-warning-mutation-fence.sql` inside one atomic installation. Creates:

- Four public tables: ingestion_batches, financial_records, validation_issues and
  persistence_attempts; their existing UUID keys, numeric/date/NULL checks, deferred
  warning consistency, source-file consistency, grouped-attempt constraints, indexes
  and warning mutation fence. Validates the new empty-table source-file constraint.
- Public functions: check_record_warning_consistency, is_safe_source_file,
  enforce_source_file_consistency and serialize_warning_issue_mutation.
- `fingence_reconciliation`: documents, jobs, job_sources, transactions, proposals,
  decisions, cases, reviews, audit, rankings and proposal_verifications; their FKs,
  indexes, sequences, immutable triggers, restrictive actor policies, all eleven
  ENABLE/FORCE RLS flags and narrowly permitted security functions.
- `fingence_db04_group_synthetic`: organizations, users, memberships,
  organization_states and sessions; membership-lifecycle trigger and restricted
  capability issue/revoke functions. This is a separate synthetic namespace, not
  fingence_m2/m3, auth.users, a password system or Jason's authorization module.
- Nonlogin roles `fingence_db04_group_runtime` and `fingence_db04_group_broker`.

The only organization authority is the synthetic lease validated by DB04 principal().
Its issuer is **urn:fingence:db04:group-synthetic:1**, never a Supabase Auth issuer.
Users, membership/version/state and expiry/revocation/suspension are checked in that
namespace. No real user/session mapping or public authentication endpoint exists.
Optional local M5 lookup is removed from this synthetic composition; Jason's schemas
are not installed, read or modified. Real team authority remains a separate integration.

The runtime gets only the reconciliation schema/function usage and required
SELECT/INSERT/sequence permissions. No UPDATE/DELETE/TRUNCATE/DDL, role admin,
BYPASSRLS or identity table access. The broker gets only synthetic schema USAGE and
issue/revoke EXECUTE, with no financial access. Runtime never owns DB objects.
The separately verified installation owner owns the new functions/tables.

New public foundation tables remain RLS-enabled with **no application runtime access**.
They lack an approved organization ownership contract, so granting a global DB02 writer
would be unsafe. DB02 services and integrity are tested on the owned local synthetic
database; this package does not claim real team DB02 runtime authorization. No DB04
runtime receives financial SELECT on those public tables.

Only newly created object ACLs are sealed. Existing roles, grants, default privileges,
public objects, Auth and provider settings are untouched. Unexpected inherited default
table/function grants abort the installation instead of being weakened or rewritten.
The script refuses public table/schema/role/function conflicts. It never resets a DB.
Its internal status-constraint replacement and principal replacement affect only objects
created earlier in this same transaction, after the absence guard passed.

### Seed and activation effects

The seed creates two synthetic organizations, two subjects and Finance memberships,
plus **NOLOGIN** roles db04_group_test_runtime (connection limit 4, runtime membership)
and db04_group_test_broker (limit 2, broker membership). UUIDs are the existing synthetic
fixture identities ending 0001–0006; they are not Production users.

After separate explicit owner approval of password provisioning, use an already approved
private owner psql terminal with TLS verification. Use `\password db04_group_test_runtime`
and `\password db04_group_test_broker` to enter different independently generated strong
passwords through masked prompts while both roles remain NOLOGIN. Never put passwords,
verifiers or URLs into SQL artifacts, shell arguments/history, Git or chat. Save only in
the ignored protected group configuration. Do not read pg_authid or export role passwords.
Then execute the reviewed activation transaction; it refuses role flag, membership or
connection-limit drift and enables LOGIN only for these two named test identities.
Authenticate independently with each restricted login and verified TLS; stop if either
fails. No owner connection may be used for backend processing.

## Exact synthetic operation proposed for approval

The operator-only CLI `scripts/db04-group/hosted-synthetic.mjs` reuses the registered
fixtures and `createReconciliationBackend`. It contains no migration/role SQL and accepts
only the fixed group direct host, postgres DB and the two named restricted logins.
Financial pool max4, broker max2, TLS certificate verification required. No pooler fallback.

Approved test scope would be the committed BANK/LEDGER fixture bytes only:

- BANK SHA256: d496b00bcc826e6833770d373c8977fd4ff4163416e2c4e2e1c50938a9b9c2ec
- LEDGER SHA256: d71e68cb8aae56e87c86b9106fe8ff96f674d08f31111f79117640d1dbbf6be4
- Expected processing ID: a15395c79e003c92d7e186d39da2d3cf9cc92c9a57c2f1ed5689defa013bb325
- Two accepted transactions; exact signed amount MYR 6380.53 each in their separate
  BANK/LEDGER representations, original BANK literal 06380.53. Cash net is MYR 6380.53;
  BANK and LEDGER are never summed together.

Creates only synthetic DB04 documents/job/source links/transactions, deterministic
suggestions, fuzzy and actual pinned offline E5 rankings, unresolved independent
verification snapshots and append-only audit/lease rows. It performs duplicate and
concurrent reuse, pool close/recreation, readback, five scoped read models and other-org
denial. No automatic financial approval; unsupported forecast stays unavailable.
No public foundation financial writes or row reads, provider dispatch, real ingestion,
HTTP route, dashboard switch, Auth or Vercel changes. The test logins must remain confined
to an owner-authorized operator environment; never distribute the synthetic broker to a
real application or treat its PRIMARY/OTHER actors as authenticated users.

The CLI requires NODE_ENV=test, refuses Vercel, and requires two ignored .local files:

1. Private group configuration containing DB04_GROUP_RUNTIME_URL,
   DB04_GROUP_BROKER_URL, optional DB04_GROUP_CA_FILE and optional existing offline E5
   runtime/model paths. No personal FYP A credential fallback. Owner connection is absent.
2. An operator record of the actual owner authorization: projectRef, database,
   scope `GROUP_SYNTHETIC_BANK_LEDGER_ONLY`, approved=true, nonempty ownerApprovalReference
   and the exact manifest `sql` array. This file records approval; it does not create it.
   Do not manufacture approval or run until the group owner approved this exact scope.

After approval, private credentials and installation verification:

```powershell
$env:NODE_ENV='test'
node --conditions=react-server scripts/db04-group/hosted-synthetic.mjs .local/db04-group.env .local/group-test-approval.json
```

The CLI verifies actual runtime/broker database roles, privileged inheritance, TLS,
eleven forced-RLS tables, absence of public/broker financial access and runtime foundation
access before its financial operation. It logs safe stages/codes and synthetic summaries.
On failure, commits may already exist: inspect the stored processing context and stop;
never blindly retry or delete data. It has no owner or inspection-account fallback.

## DB03 and failure handling

Reuses the existing native DB03 RecoveryLab rather than rebuilding recovery. The local
test exports only generated synthetic data into its owned temporary directory, verifies
the dump checksum, restores atomically into a new DB in a separate fresh loopback cluster,
compares every row as PostgreSQL JSON text plus constraints/indexes/functions/triggers/
policies/effective ACLs, then reads through a restricted recreated backend. Corrupt
checksums/reused destinations are rejected. Failed labs are stopped and retained; cleanup
removes only successfully verified owned paths. No hosted data is exported/restored.

Only PostgreSQL 18 is installed locally (actual version recorded in test evidence).
This does **not** verify PostgreSQL 17.11 or the group server/provider version. Obtain
the actual group version and available managed backup/restore facilities through approved
access, then agree RPO/RTO, role/extension compatibility and an isolated recovery target.
No group backup export, paid feature, Production restore or encryption work is authorized
by this package. Personal FYP A's backup waiver does not cover group Production.
Owner must explicitly accept the group's recovery readiness before deployment; no hosted
recovery pass is claimed from the synthetic local drill.

For definite SQL errors, roll back the active transaction and preserve the error evidence.
For uncertain COMMIT, stop and inspect catalog/records under separately authorized access.
After an acknowledged install, rollback is a separate reviewed forward repair; no automatic
DROP, CASCADE, table reset, data deletion or restore is supplied. Disabling any future
application wiring does not erase audit history. Stop on drift or unexpected ACLs.

## Current completion boundary

All three SQL artifacts and the restricted scenario are prepared for review and local
verification. See db04-group-package-results.json and db04-group-local-recovery.json for
actual local results. AI01–AI05 algorithms/evidence are reused unchanged; frozen evaluation
metrics are not rerun/replaced. Hosted test count is zero. No module is marked deployed.

Final local verification: **641 passed, 0 failed, 1 optional private-dataset skip**.
DB04/group subset: **101 passed, 0 failed, 0 skipped**, including **37 native PostgreSQL
tests**. The standalone synthetic scenario passed **22 local checks**; the hosted-only
TLS checks were not claimed. PostgreSQL **18.6** restored all **20 synthetic tables**
with identical row/security metadata digests and successful restricted backend read.
TypeScript, zero-warning focused lint, server boundary and reviewed SQL checksums pass.

**Specific approval needed:** group owner approval of the three exact SQL hashes above,
private password provisioning for only the two named test roles, and the exact registered
synthetic CLI scope on zmtdozblpvtjniehwjrw/postgres; acceptance of the isolated synthetic
authority and recovery limitations. Approved private group inspection/owner/runtime
configuration must be supplied locally, with its nonsecret location shared. Do not send
credentials in chat. If this synthetic authority is not approved for group Production,
stop before installation and use a separately approved staging target.
