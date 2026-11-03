# Group DB04 / AI06 hosted clock correction and execution

3 November 2026. Branch `feature/db04-ai06-group-integration`, starting/current
commit `943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9` plus reviewed uncommitted changes.
This report supplements the earlier admission/TLS failures; it does not reclassify
those attempts as passing. No automatic commit or push was made. PR #59 is unmerged.

## Approved correction

The hosted admission function compares expiry against actual database time using
`clock_timestamp()`, not transaction time (`now()`) or statement time. A client-clock
offset made the original client deadline exceed the function's 30-second maximum.

The fixed broker issue query now computes:

```sql
SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant(
  $1,$2,$3,$4,$5,clock_timestamp()+interval '30 seconds')
```

Only five identity/token parameters are bound. Neither expiry nor lease duration is
caller-selectable. The broker allowlist rejects the old six-parameter issue query
and arbitrary SQL. The function checks the deadline after its expression is evaluated
in the same database call; there is no separately sampled client clock or round trip.
The unchanged database guard still rejects expired deadlines and deadlines exceeding
its own clock plus 30 seconds. No migration, hosted function, role, privilege, RLS,
schema, SSL setting, Auth, frontend or Vercel change was made by this task.

Correction files: `lib/server/reconciliation/group-synthetic.ts`,
`tests/reconciliation-persistence/group-target.test.ts`,
`tests/reconciliation-persistence/group-package.native.test.ts`.
Earlier uncommitted exact Session pooler and explicit private configuration changes
remain intact, including `scripts/db04-group/hosted-synthetic.mjs`.

## Fresh corrected local verification

Complete DB04/AI06 directory with `DB04_E5_SMOKE=1`: **114 passed, 0 failed, 0 skipped**.
Includes **43 native PostgreSQL tests**, real offline E5 inference/persistence and
the complete 22-check local synthetic scenario. Local server was PostgreSQL 18.6;
this is distinct from the hosted PostgreSQL 17.11 evidence below.

New checks exercise normal application time, application time a day ahead/behind,
acceptance at the database-generated 30-second boundary, rejection beyond it at
31 seconds, rejection of expired admission, and rejection of the former caller-
supplied expiry query before dispatch. Existing unauthorized query, TLS/target,
rollback, immutable evidence and isolation regressions remain passing.
Next type generation, TypeScript, scoped ESLint, server boundary and diff whitespace
checks passed. Previous 107-test results are historical, not the corrected totals.

The remaining full-project regression run returned **1201 passed, 52 failed,
104 skipped**. Together with the disjoint DB04 directory: **1315 passed, 52 failed,
104 skipped**. These failures are retained, not relabelled as passing. See the
machine-readable evidence for unchanged-main comparison and failure names.
An isolated export of unchanged reviewed main `cb5db46` reproduced the **same 52
failing test identities**, with **1201 passed / 52 failed / 104 skipped**. No current
failure was absent from that comparison; all failing test source files match main
after line-ending normalization. Main and teammate branches were not checked out
or modified. The full project suite is not passing.

## Hosted security and provisioning

Authorized target: group FinGence-Production, project `zmtdozblpvtjniehwjrw`,
database `postgres`, PostgreSQL **17.11**. Only the already approved registered
BANK/LEDGER fixture pair was processed. All three reviewed installation/seed/
activation checksums passed; none of those SQL transactions was rerun.

Both restricted roles authenticated through the exact pinned Session endpoint,
port 5432, with verified certificates and hostnames. Client TLS was TLSv1.3.
Both own-backend pg_stat_ssl rows reported true / TLSv1.3 /
TLS_AES_256_GCM_SHA384. Memberships and connection limits remained 4/2, without
superuser, BYPASSRLS, role/database creation or privileged inherited memberships.
All eleven reconciliation tables retained enabled/forced RLS. Broker financial
access and runtime/broker foundation access remained absent. Explicit unauthorized
SELECT attempts returned 42501. Owner/inspection credentials were not runtime inputs.

The corrected issue transaction committed, its live Finance principal resolved,
and the lease was revoked through the existing helper. Before processing, an
organization-scoped inspection found **zero jobs and zero transactions** for the
fixed processing ID, resolving the earlier generic attempt's financial-state question.
An inspection-only probe initially used READ ONLY and returned 25006 because the
existing principal function takes row locks. The probe was corrected to use a normal
transaction containing only the scoped SELECTs; no guard or permission was weakened.
A separate private diagnostic placeholder mismatch returned 08P01 and was corrected;
it was not an application-driver failure or financial attempt. Neither diagnostic
committed financial data. The full financial workflow was not blindly retried.

Restricted synthetic provisioning verification is complete. This is not real user
authentication or approval of Jason's Production identity/authorization contract.

## Actual hosted financial workflow: 24 passed, 0 failed

The existing `scripts/db04-group/hosted-synthetic.mjs` completed with acknowledged
financial commits and readback. Processing ID:

`a15395c79e003c92d7e186d39da2d3cf9cc92c9a57c2f1ed5689defa013bb325`

It verified two accepted BANK/LEDGER transactions, exact MYR `6380.53` per separate
source representation, original BANK literal `06380.53`, correct VALUE_DATE/
POSTING_DATE basis and unchanged registered fingerprints:

- BANK: `d496b00bcc826e6833770d373c8977fd4ff4163416e2c4e2e1c50938a9b9c2ec`
- LEDGER: `d71e68cb8aae56e87c86b9106fe8ff96f674d08f31111f79117640d1dbbf6be4`

Stored evidence includes deterministic VERIFIED_SUGGESTION proposals, fuzzy ranking,
actual pinned offline E5 ranking, and independent UNRESOLVED verification snapshots.
No accounting transaction was automatically approved. The five financial read models
used the same processing context; cash net was `6380.53`, with forecasting correctly
UNAVAILABLE for the small fixture. BANK and LEDGER values were not summed together.
Source lineage was independently checked through the restricted database service.

Duplicate and concurrent duplicate processing reused the stored result. After closing
and recreating database pools, the backend retrieved identical transactions and
financial read models. Another synthetic organization was denied. The complete list
of 24 expected/passed checks is in the accompanying JSON evidence.

## Boundaries and next work

The isolated synthetic DB04/AI06 hosted milestone passed. Broader project regression
failures remain separately unresolved. Real group authentication, real trusted BANK/
LEDGER ingestion and public financial APIs are not enabled by this result. Existing
public DB01–DB03 records were not modified; neither runtime role can access them.
No hosted rollback fault injection or recovery restore was performed; rollback and
recovery tests were disposable-local evidence only. No hosted recovery claim is made.
The unrelated UX branch and all teammate branches were preserved.

Proposed commit title: `fix(db04): derive group synthetic admission expiry from PostgreSQL`

Proposed commit body: Use the existing database clock for the fixed broker expiry,
removing caller-supplied expiry while preserving the 30-second database guard and
restricted query allowlist. Reuse existing DB04 transactions, AI06/E5, independent
verification and read models. Include pinned Session pooler/configuration changes,
114 passing corrected DB04 tests, 24 passing hosted checks and separate full-suite
failures. No hosted SQL/permissions or real authentication changes.

Proposed PR #59 update: Record acknowledged group hosted synthetic persistence,
offline E5 and verification storage, reconnect/duplicate/isolation success, both TLS
legs, exact test counts and unchanged security boundaries. Preserve historical failed
attempts and document unrelated full-project failures and real-identity/ingestion gaps.
