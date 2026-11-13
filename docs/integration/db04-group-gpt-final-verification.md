# Group-compatible GPT 005 — focused verification and integration status

12 November 2026 · `feature/ai06-gpt-integration-celester`

**Hosted integration status: BLOCKED — approved restricted group catalog connection is not configured.** Focused verification is complete. No new general review cycle is required to establish that blocker.

## Completed focused verification

Reviewed the exact group-target alternative at `supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql`, SHA256:

`e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e`

Its only body differences from original 005 remain the group membership FK (`fingence_db04_group_synthetic.memberships`) and runtime grant (`fingence_db04_group_runtime`). Neither migration was changed in this task.

Added `tests/reconciliation-persistence/gpt-group-compatibility.native.test.ts` and byte-preserved historical group contract fixture `tests/reconciliation-persistence/sql/group-contract-943e0ef.sql`. Fixture origin is local Git commit `943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9`, path `supabase/sql/db04-group-review/install-review.sql`, SHA256 `21ea11b4eaf63897e9379ee0cb6cefb3cc973662cdc65c733a3eb84ec60b6df9`. This fixture is ONLY for a newly initialized disposable local cluster; never run it on the group database or any existing database. It represents the already installed group DB01–DB04 baseline, not a proposed reinstall.

The harness uses fixed loopback connections on a new port, a fresh PostgreSQL 18.6 data directory, synthetic identities/documents and mocked GPT/E5. It installs that historical baseline and then the exact group alternative to 005. Original local M2/M3 identity namespaces and original runtime role are absent, so the native tests cannot pass by accidentally using legacy aliases.

Final focused result: **34 passed / 0 failed / 0 skipped**, 3 files:

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Group-compatible native PostgreSQL | 15 | 0 | 0 |
| GPT proposal adapter | 11 | 0 | 0 |
| GPT persistence | 8 | 0 | 0 |

The native cases cover the actual membership FK target, existing group runtime privileges, forced RLS including nonsuperuser owner behavior, managed-default ACL removal, tenant/record/source constraints, immutable evidence, exactly-once evidence/audit under concurrent retries, rollback on audit/child failure, abstentions/empty results, repeated processing, pool reconnection, independent verification evidence and deterministic/fuzzy/E5 storage preservation. The group-specific case verifies that PERSISTED audit rows resolve a nonnull group session grant bound to the same actor/organization through the existing audit FK/default.

The initial test run failed in suite setup because the copied AI06 seed omitted the group membership `version` column, which has no default. That run had 19 unit passes and 15 unexecuted native cases; it was not a native pass. The fix sets synthetic fixture membership version to 1, matching group sessions. No migration, constraint, authentication rule or Production service was weakened. The final successful run supersedes that attempt; do not add repeated counts.

Command (existing local binaries, loopback-capable execution):

```text
FINGENCE_DB04_GPT_NATIVE_APPROVED=1
FINGENCE_TEST_PG_BIN=C:\Program Files\PostgreSQL\18\bin
node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/gpt-group-compatibility.native.test.ts tests/reconciliation-persistence/gpt-persistence.test.ts tests/reconciliation-persistence/gpt.test.ts --maxWorkers=1 --reporter=verbose --reporter=json --outputFile=.local/reviews/gpt-group-final-20261112/tests.json
```

TEMP/TMP used ignored workspace `.local/gpt-test-tmp`. Clusters were stopped and removed; no `fingence-*` test directories remained there. TypeScript, focused ESLint, server-boundary and `git diff --check` passed. Earlier 157/0/1 regression evidence remains historical and was not rerun or combined with these 34 results. Real pretrained E5 was verified in that earlier run; this focused group's E5 interface test uses a 384-dimensional test double and does not claim real inference.

## Immediate group readiness check

After starting focused verification, relevant local group/inspection configurations and inherited process metadata were checked without exposing credentials or opening connections. The outcome is unchanged:

- Group owner, application runtime and broker configurations exist and bind to the historical group project candidate. They are not permitted inspection identities and were rejected before connection.
- The separate inspector configuration targets personal FYP A; it was rejected and never used.
- **Approved group inspector configuration candidates: 0.** No actual group TLS peer, current role/effective permissions, main database-branch identity or live catalog can be verified through an approved restricted identity.

Historical project candidate is `zmtdozblpvtjniehwjrw`, database postgres. Group `FinGence-Production` and main branch remain user-declared/currently unverified. Live PostgreSQL version, installed keys/RLS/roles/audit dependencies and collision absence remain UNINSPECTED, not failed or passed. No reviewed group catalog checks were executed, because the access precondition failed. No owner/service/runtime/broker fallback was attempted.

Sanitized access evidence is retained at `.local/reviews/gpt-group-final-20261112/access-preflight.json`. It contains classification booleans/configuration key names, not credential values. Hosted connections attempted: **0**; hosted SQL statements/DDL/DML, financial/Auth/session rows read, permission/credential changes, Groq calls, push/merge/deployment: **0**.

## Exact next action — no additional general review

The authorized group owner must **supply an existing approved catalog-only connection privately**, with current immutable project/main-branch attestation and verified TLS trust configuration, or explicitly approve and perform the already prepared provisioning procedure if such an identity does not exist:

`supabase/sql/db04-group-access-review/01-provision-catalog-inspector-review.sql`

Prepared file SHA256: `ca9c38abcfefd58eaf7bd7b5f2d96be5e45f911ba7f30b5a6768208633bf4fe7`.

That procedure creates a new NOLOGIN role with CONNECT and a fail-closed effective privilege guard. Private credential setup and LOGIN activation require owner approval and the prepared masked procedure; this task does not authorize them. If unsafe inherited PUBLIC privileges block its guard, stop without broadening/revoking shared rights. Do not reset an existing role or provide owner/runtime/broker credentials as a substitute.

Once the restricted access exists, the current task's authorized inspection can resume directly: attest exact group/main endpoint and certificate, verify current_user=session_user and no unsafe role/table/column/routine capabilities using `supabase/tests/db04-group-catalog-access-gate-review.sql`, then run `supabase/tests/db04-005-group-catalog-review-v2.sql` under its read-only transaction. No financial row reads. Stop on any identity/permission mismatch. No need to rerun these completed focused tests merely because private access is supplied.

## Deployment handoff, conditional on a compatible actual catalog

No hosted deployment is currently READY. After restricted inspection actually confirms the historical group contract and absence of conflicts:

1. Record the actual target/version, key/FK/role/helper/audit compatibility and exact candidate checksum above; preserve the inspected baseline metadata. PostgreSQL 18.6 local success is not proof for an unobserved target major version. Any material version/catalog difference must be resolved by focused matching-contract verification, not by modifying teammates' objects.
2. Confirm group-authorized recovery evidence, separate migration owner/runtime, bounded lock/statement timeouts and change window. Existing application GPT methods remain local-only; database DDL alone does not enable hosted provider/application dispatch.
3. Obtain explicit target-specific approval to apply **only** the group-compatible alternative at the checksum above. Never apply both original/group 005, never reinstall 001–004 or the test fixture, and never bootstrap identity tables to manufacture compatibility.
4. Only after that separate approval may the authorized deployment operator apply its single BEGIN/COMMIT transaction. No hosted application command is issued in this task.
5. Perform approved read-only postchecks: two new GPT tables, group membership reference, correct group runtime SELECT/INSERT only, forced RLS, policies/immutable/completeness/audit triggers, UNRESOLVED-only checks and expected FK internal additions. Existing logical data/interfaces, decisions, E5 evidence, ingestion and authentication stay unchanged. Production smoke writes and application/provider activation need their own explicit scope.

No Production object was touched by this task. The new local group test compares existing catalog/data fingerprints and protected contexts; it does not certify unseen hosted state. Only AI06 test harness/fixture and this result report are new changes in this verification step. Existing migrations, teammates' source and Production service code remain unchanged.

**Stop condition reached: genuine restricted-access/owner-approval blocker. Next operation is access provisioning or private delivery, not migration 005.**
