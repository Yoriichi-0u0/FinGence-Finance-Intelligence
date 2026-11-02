# Coordinated DB02 / DB03 / identity / DB04 approval package

Prepared 2 November 2026 from `c98494a571c2b7992a50bef842b1695275077ba3`,
only on `feature/db04-ai06-supabase-celester`, Draft PR #57. Target remains personal
FYP A `fhipzomczevbpybezzxu`, database `postgres`; team Production is excluded.
This package authorizes no hosted mutation. Its new SQL is proposed, not installed.

## What is actually established

Reuse the existing private restricted catalog report and committed sanitized
`db04-hosted-inspection-results.json`: four foundation tables/numeric columns,
existing consistency triggers, absent DB02 fence, one NOT VALID check, missing
five M2/M3 identity relations and eleven DB04 tables/runtime/security functions.
No account creation, password setup or broad rediscovery was repeated.

One missing detail was checked with the existing restricted login: the actual
`public.is_safe_source_file(text)` body matches the local migration after whitespace
normalization; it is security-invoker, owned by postgres, search_path pg_catalog.
The sanitized result is `db04-hosted-source-file-predicate.json`. This was read-only
function-catalog metadata, not a financial query. No hosted rows, Auth changes,
backup export, validation, migration or other database writes occurred this cycle.

## A. Recovery readiness

No usable personal FYP A backup/restore evidence was supplied or found in the
known local backup artifacts. That means UNVERIFIED, not proof that no provider or
off-site backup exists. Prior dashboard Free/No backups labels cannot establish
restore capability. Supabase recommends regular exports for free-tier projects;
database backups do not include Storage object bytes. No paid feature was enabled.
[Supabase backup scope/options](https://supabase.com/docs/guides/platform/backups).

Executable synthetic logical and physical recovery tests reuse the existing DB03
RecoveryLab from backend commit `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca`.
Provenance is in `scripts/db04-preparation/recovery-lab.provenance.json`. No branch
was merged and no old DB03 evidence changed. Source and destinations are owned,
new loopback clusters/databases; tool subprocesses strip database/service/password
environment settings. Custom archives are checksum-checked and restored atomically
into unused targets. Corrupt archives and reused targets are rejected. Effective
ACLs are compared, since pg_dump can normalize explicit default ACLs to NULL.
Financial JSON remains PostgreSQL text, preserving every numeric digit. Physical
backup is verified with pg_verifybackup and recovered into another local cluster,
including roles and all eleven forced-RLS tables. Successful labs are stopped and
removed through ownership checks; failed labs retain stopped synthetic diagnostics.

These are PostgreSQL 18 local synthetic proofs, not a hosted PostgreSQL 17.11
managed restore or measured production RPO/RTO. Logical pg_dump does not contain
cluster roles; local logical restoration uses already-provisioned test roles.
Physical backup is a local-cluster test, not an available Supabase physical-export
capability. The runbook below separates future hosted-data authorization and scope.

## B. Existing constraint

Exact hosted expression: `CHECK (public.is_safe_source_file(source_file)) NOT VALID`.
The verified helper rejects empty/blank, path-like or control-character filenames.
The source migration deliberately marks the financial-record check NOT VALID to
preserve legacy names while enforcing new/updated rows. This explains the source
design, not a proven history of every hosted migration or row.

Existing rows may violate it; none were selected. A future DB02 identical-value
parent UPDATE still rechecks CHECK constraints and may fail on such a legacy row.
Native tests preserve a deliberately invalid historic scratch row, show failed
validation and no-op UPDATE, and prove no cleanup occurs. They do not drop/weaken
the real financial-record constraint. A separate valid synthetic financial fixture
executes the exact validation proposal without changing row values.

Exact scan proposal: `db04-source-file-validation-review.sql`, with 3s lock and
30s statement limits. VALIDATE scans rows and takes SHARE UPDATE EXCLUSIVE; it
does not rewrite financial values. It can contend with maintenance/DDL and consume
I/O. Ordinary concurrent reads remain possible, proved locally; an incompatible
exclusive lock times out. A timeout or violation rolls back and stops, retaining
NOT VALID and all data. Do not output error DETAIL containing private data or
auto-repair, delete, drop or retry. Owner must separately approve this existing-row
scan and the maintenance limits. [PostgreSQL 17 validation/locks](https://www.postgresql.org/docs/17/sql-altertable.html).

## C. DB02 fence

Existing SQL is unchanged, SHA256
`8a991309f2f4d4192ac9a782cc369348c93c0f098ce31c370424940897a33089`.
The saved catalog plus prior restricted name check establish the table/column,
ordering and role dependencies, and absent function/trigger name conflicts as of
inspection. Fresh drift checking is required before any approved deployment.
It adds one security-invoker function, one BEFORE trigger and restrictive EXECUTE
permissions on that new function. Existing tables/ACLs/RLS and financial values
are preserved; installation itself runs no financial UPDATE. Future issue mutations
perform identical-value parent updates before deferred warning checks. Expected
effects are serialization, possible lock waits, 40001 or deadlock victims, and
legacy-check rejection. No automatic financial retry is permitted.

Native tests exercise contending warning updates, 55P03 lock timeouts, stale
REPEATABLE READ 40001, an actual two-parent 40P01 deadlock, victim rollback and
unchanged issue evidence, plus explicit rollback. Existing DB02 tests retain
accepted/rejected counts, exact money and warning lifecycle checks. Migration
BEGIN/COMMIT is atomic; a failed install rolls back. Removing a committed fence is
a separate approval, not an automatic down migration or recovery shortcut.

## D. Proposed hosted identity v1

This is a new private contract, not the local M2 password/V2 bootstrap. No local
email/password tables, signup route, auth.users trigger or fabricated membership
is installed. The proposal creates only the required FK-compatible identity
namespaces/tables plus a nonlogin broker role and tightly granted functions.
Users map explicit `(issuer, subject)` to an owner-approved internal user ID;
memberships/organizations come only from trusted database authority. There are no
seed mappings in the SQL. Missing or multiple active Finance memberships deny.

`hosted-identity.ts` is internal and not imported by any route. Its trusted server
dependency must verify cryptographic identity/issuer/audience/expiry and separately
authoritative session/revocation/suspension state bound to the same subject/session.
No JWT decoder, browser tenant/role claim or getSession result is accepted as
authority. Cryptographic verification is intentionally not reimplemented. The
repo has no approved Supabase SDK/JWKS/lifecycle integration to wire here yet.
Tests use `SYNTHETIC_TEST_AUTHORITY`, rejected outside NODE_ENV=test.

Supabase documents signature verification through getClaims, and that an unexpired
JWT can outlive server-side session termination. Thus signature validity alone is
not the full revocation contract. Provider verification, session-lifecycle source
and cache/rotation policies require Jason's approval.
[JWT guidance](https://supabase.com/docs/guides/auth/jwts),
[server session limitations](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

After upstream verification, a separate broker connection can EXECUTE issuance/
revocation functions, but cannot SELECT or mutate identity tables directly. It
issues a random server-only capability; only SHA256, upstream session ID, internal
user/org, version and expiry are stored. Proposed maximum lease is 30s, lifecycle
freshness 5s, bounded by upstream expiry. The capability is scoped to one internal
operation and revoked in finally, never returned to browser. Cleanup failure does
not retry an acknowledged financial operation. Original errors, including unknown
COMMIT outcomes, are preserved.

The financial connection is separately restricted to the nonlogin DB04 runtime
role. The proposed principal joins/locks session, user, membership and organization
state each transaction; expiry/revocation/suspension/activation/version mismatch
deny. Membership lifecycle locks its subject, preventing phantom tenant insertion,
and role/active changes advance membership version. Audit adds a grant FK bound
to the same actor/org, retaining upstream-session traceability without tokens or
financial content. Safe definer search paths, ownership distinct from runtime,
RLS, public EXECUTE revocations and new-object default-grant sealing are tested.

**Unresolved decisions:** Jason's actual verifier SDK/keys and issuer policy,
authoritative upstream session existence/deletion/revocation feed, 30s/5s SLA and
in-flight revocation semantics, clock skew, who provisions/mutates subject/org
mapping, multi-organization selection, audit/lease retention, role owner/login/TLS
credential custody and lifecycle administration. Immediate global upstream
revocation is NOT proved by this bounded-lease model. No hosted deployment/API
enablement is safe until these are resolved. A label on an injected dependency is
not evidence that real Supabase Auth has been verified.

## E. Exact coordinated sequence and approval boundaries

`db04-combined-approval-manifest.json` contains exact SHA256 values, target,
ordered files and blockers; regenerate with `node scripts/db04-preparation/plan.mjs`.
It has no apply mode or database/environment loading. The proposed sequence is:

1. Approved protected backup/export and independent restore verification, with
   required scope/retention/key custody decisions; no export is authorized now.
2. Separately approved source-file validation scan. On violation, stop for a new
   owner decision; no data repair is included.
3. Separately approved unchanged DB02 fence transaction.
4. Separately approved `db04-hosted-identity-v1-review.sql`, only after Jason's
   authority/mapping/SLA decisions; new tables contain no invented users or tenants.
5. DB04 001, 002, 003, 004 in their existing dependency order.
6. `db04-hosted-principal-v1-review.sql` replaces only the local-session principal,
   adds audit-grant lineage and seals new DB04 objects against managed defaults.
7. Fresh independent metadata/security checks, then separately approved authority
   provisioning, synthetic hosted writes and development API/view verification.

All files are exact review artifacts, not authorization. Explicitly approve each
scan/schema/role/function operation; do not treat this as a single blind replay.
Create-schema/name conflicts fail closed, never IF NOT EXISTS/overwrite. Existing
catalog absence of required tables does not prove entire namespaces are empty.
No application login/credentials, mapping rows or Supabase Auth changes are seeded.
No data or API is exposed between the new-object migrations; mapping and financial
writes wait until final sealing and verification. Native tests model broad managed
defaults on NEW objects and prove service_role/anon/authenticated cannot issue
capabilities or read new protected identity/financial data afterward.

Each file has its own transaction. Failure rolls back that file, not earlier
acknowledged files. Keep APIs disabled, stop and inspect partial progress; do not
rerun files or drop schemas automatically. Before any financial writes, restore
or removal of empty newly created objects needs a distinct reviewed rollback plan.
After writes exist, use the verified recovery procedure; no DROP CASCADE cleanup
against hosted FYP A. Existing DB01 rows are not rewritten by identity/DB04 DDL.

The existing four DB04 migrations are reused unchanged, including exact numeric,
source hashes, date lineage, stable processing IDs, duplicate fences, immutable
evidence and forced RLS. No C1/V2-to-CashSource cast is added: trusted BANK/LEDGER
authority, VALUE_DATE evidence and organization/processing binding remain required.

## Reproduce and distinguish evidence

`node scripts/db04-preparation/run.mjs` executes only synthetic local labs and the
existing affected suites. It accepts no target arguments. No hosted URLs/env files
are loaded by the recovery harness. The combined lab covers DB01/DB02, proposed
identity, DB04 persistence/fuzzy/real installed E5/independent verification,
authorized read models for all five views, cross-org direct RLS, lifecycle failures
and logical/physical recovery. Existing live HTTP/five-page tests remain separate
and use the original explicitly local identity; they do not demonstrate hosted
HTTP authentication. No public financial route or Production demo changed.

The coordinated package is locally exercised but **not deployment-authorized or
fully deployment-ready** while hosted recovery and Jason's authority decisions
are unresolved. No hosted financial round trip, Supabase Auth/RLS or recovery
success is claimed from synthetic results. Frozen AI01--AI05 research is unchanged.

## Verification and explicit signoffs

Affected suite: **174 passed, 0 failed, 0 skipped**, including **58 native
PostgreSQL tests**. Final expanded recovery/identity subset: **28 passed, 0 failed,
0 skipped**, including 25 native tests; these overlap, do not add the counts.
The final subset additionally compares restored columns/defaults, constraints and
validation state, function definitions/permissions, triggers, indexes, namespace
ownership and RLS policies. Exact row text, effective ACLs, fresh restricted reads
and the physical drill all pass. Typecheck, full lint, server boundary and whitespace
checks pass. Machine evidence is `db04-combined-preparation-results.json`.

The initial 18/1/0 lab run compared raw NULL/default ACL storage instead of effective
privileges; that representation-only comparison was fixed without changing data or
grants. A TypeScript PoolClient property reference was replaced by pg_backend_pid.
Subsequent 20/0/0, 170/0/0, 172/0/0 and final runs are overlapping development runs.
Failure reports remain private local evidence; no frozen research was edited.
Full project was not rerun; the prior 30 unchanged-main failures remain disclosed.

Separate owner signoffs are required for each reviewed operation below, after its
prerequisites. None has been granted or executed by this preparation task:

| Approval | Exact scope |
| --- | --- |
| Backup/data handling | Defined export scope, protected destination and recovery drill; no present hosted export authorization |
| Validation | db04-source-file-validation-review.sql, including implicit existing-row scan |
| DB02 | db02-001-warning-mutation-fence.sql new function/trigger/EXECUTE restrictions |
| Identity | db04-hosted-identity-v1-review.sql new private schema/tables/broker/functions, only after Jason's contract approval |
| DB04 foundation | db04-001-reconciliation.sql new reconciliation schema/nine initial tables/FKs |
| DB04 security | db04-002-reconciliation-security.sql nonlogin runtime role/RLS/functions/grants |
| AI evidence | db04-003-ranking-evidence.sql new immutable ranking table |
| Independent evidence | db04-004-proposal-verification.sql new immutable verification table |
| Hosted principal/seal | db04-hosted-principal-v1-review.sql principal replacement, audit-grant FK and new-object permission sealing |

Backend login provisioning, authority integration/mapping data, provider Auth changes,
synthetic hosted financial writes and API deployment are excluded and need their
own exact approval. This package does not ask for blind execution while backup,
historic validation or identity authority remains unresolved.
