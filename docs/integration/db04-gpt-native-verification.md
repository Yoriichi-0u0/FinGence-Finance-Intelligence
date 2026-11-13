# DB04 migration 005 — local native PostgreSQL verification

Verified 12 November 2026 on `feature/ai06-gpt-integration-celester`.
Target: fresh disposable loopback PostgreSQL **18.6**, Node **24.14.1**, synthetic documents and test identities only.

**Result: locally verified after an ACL correction. Group Supabase deployment is not approved or target-certified.** Neither FinGence-Production nor personal FYP A was contacted. No Groq call, push, merge or deployment occurred.

## Skip diagnosis and execution history

The earlier ten native cases were skipped intentionally because `FINGENCE_DB04_GPT_NATIVE_APPROVED=0`. They were not passes. The current user request authorized local execution, so the flag was set to 1 and installed PostgreSQL 18 binaries were used.

| Attempt | Passed | Failed | Skipped | Meaning |
| --- | ---: | ---: | ---: | --- |
| Earlier preparation milestone | 0 native | 0 native | 10 native | Approval gate off; no database execution |
| Initial sandboxed native attempt | 0 | suite setup failed | 10 | Cluster started, but client loopback connect failed EACCES before migrations; cleanup stopped/removed cluster |
| First loopback-permitted attempt | 9 | 1 | 0 | Applied 001–005; AI06 E5 unit double incorrectly returned 2 dimensions |
| Expanded native attempt | 13 | 0 | 0 | Corrected unit double to existing required 384 dimensions; added schema, data, reconnection and owner-RLS checks |
| Managed-defaults challenge before SQL fix | 12 | 2 | 0 | Confirmed unsafe direct grants inherited by new objects |
| Managed-defaults challenge after SQL fix | 14 | 0 | 0 | New-object ACL sealing passed |
| Final relevant regression run | **157** | **0** | **1** | 21 files, includes the final 14 GPT native cases; counts are not cumulative across attempts |

The final skipped case is the existing `runs the real Next server: upload, retrieve, revisit and deny another organization` test, explicitly excluded from this database-focused run. Its Next/font path can fetch web fonts; protected HTTP-handler and production-isolation tests ran. The separate `preparation.native.test.ts` recovery-lab suite was excluded entirely and is not counted as skipped or passed. All 14 migration-005 native cases executed; none were skipped.

The sandbox initially denied local TCP. The same harness was rerun with approved loopback-capable execution. Every PostgreSQL Pool in these native harnesses specifies `127.0.0.1` and a newly allocated cluster port; neither accepts a hosted database URL. No existing database service or user database was reused. Each cluster was stopped and its validated temporary directory removed by the harness; no `fingence-*` cluster directories remained in workspace TEMP after completion.

## Changes made during this verification

1. `supabase/sql/db04-005-gpt-evidence-review.sql`: after revoking PUBLIC, inspect ACLs of only the new `gpt_runs`, `gpt_items`, `gpt_complete()` and `gpt_audit()` objects and revoke non-owner direct grants. Then grant runtime only SELECT/INSERT on the tables. This prevents managed default privileges from retaining rights for anon/authenticated/service_role or other direct grantees. No global default privileges, existing objects, existing role memberships or migrations 001–004 are changed.
2. `tests/reconciliation-persistence/gpt-evidence.native.test.ts`: fix the E5 unit double to 384 dimensions; increase native coverage from 10 to 14 cases; simulate hostile managed defaults, verify existing catalog preservation, compare existing table-data fingerprints, reconnect the pool, test repeated processing, exercise forced RLS as a nonsuperuser table owner and assert concrete SQLSTATEs for direct FK/check/RLS failures.
3. This report and status links in the earlier integration/persistence reports.

No production TypeScript service, financial rule, E5 implementation, existing migration, route or teammate-owned source was changed during this verification step. The branch still includes the earlier uncommitted GPT adapter/persistence preparation work; the review ZIP includes that cumulative context.

## Native database evidence

The GPT harness initializes an empty cluster, creates synthetic roles, installs the local M2/M3 and financial prerequisites, then DB04 migrations **001, 002, 003, 004 and 005** in order. Migration 005 runs as the separate owner identity; application operations run as `gpt_test`, a nonsuperuser NOBYPASSRLS login inheriting the restricted runtime role.

The 14 GPT native cases verify:

- Preservation of the captured pre-005 user-schema catalog properties and ACLs. The snapshot compares namespaces, relations/owners/ACLs/RLS flags, column types/defaults/nullability, constraints, noninternal triggers, RLS policies and function definitions/ACLs. It excludes only the newly added GPT objects from the after snapshot.
- Persistence of suggestions, abstentions and empty responses, database timestamps, exact record bindings and source hashes, independent verification checks/reasons, and UNRESOLVED-only outcomes.
- Tenant/job/source foreign keys, record FK rejection, actor binding, wrong outcomes, completeness constraints and rollback.
- Forced RLS flags, cross-tenant denial, unauthenticated zero-row reads, and actual owner RLS enforcement after SET ROLE to a nonsuperuser NOBYPASSRLS owner of the new run table.
- Restricted runtime/public/managed-role grants, including a local BYPASSRLS service_role test identity with no new-object privileges.
- Rejection of runtime UPDATE/DELETE/TRUNCATE and owner UPDATE by the immutable trigger.
- Concurrent identical requests resulting in one complete run/item and exactly one new PERSISTED audit event.
- Audit-denial rollback, incomplete-child rollback and malformed child FK rollback, including rollback of header/audit writes.
- Repeated deterministic processing and evidence persistence after closing/reopening the pool; same processing ID, evidence ID, stored timestamps and contents.
- Existing table-data fingerprints unchanged across GPT persistence/reconnection/reprocessing, excluding audit because expected audit appends are part of the contract. This includes loaded unrelated prerequisite/financial tables; existing deterministic proposals, rankings and verification snapshots also compare equal.
- Expired/revoked/non-Finance denial and compatibility with unchanged deterministic/fuzzy/E5 interfaces and protected reads.

The broader final run also executes **32 existing DB04 native cases** against a separate fresh local cluster, including actual pinned offline E5 ranking persistence, existing financial contracts, source identities, tenant/session enforcement, concurrent deterministic processing, unknown-commit handling and protected HTTP handlers. The standalone actual offline E5 smoke also passed. Model weights were already installed, checksum-pinned and loaded through the existing worker that disables remote models/fetch; no model installation/download was performed.

These assertions certify the loaded local prerequisite objects, not unseen hosted teammate objects. Production/team objects could not have been modified by these local-only connections, but their actual catalog/data state was not inspected.

## Commands and final checks

Local environment for the final test command:

```powershell
$env:TEMP=(Resolve-Path .local/gpt-test-tmp).Path
$env:TMP=$env:TEMP
$env:FINGENCE_DB04_GPT_NATIVE_APPROVED='1'
$env:FINGENCE_TEST_PG_BIN='C:\Program Files\PostgreSQL\18\bin'
$env:DB04_E5_SMOKE='1'
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:HF_HUB_DISABLE_TELEMETRY='1'
node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence --exclude tests/reconciliation-persistence/preparation.native.test.ts --testNamePattern '^(?!.*runs the real Next server).*' --maxWorkers=1 --reporter=verbose --reporter=json --outputFile=.local/reviews/gpt-native-20261112/regression-results.json
```

Final evidence: **157 passed / 0 failed / 1 skipped**, 21 test files passed. Within that run: GPT native **14/0/0**; existing DB04 native **32/0/1**; standalone actual E5 **1/0/0**. Do not sum earlier attempts into the final result. Vitest JSON's suite count includes nested describe blocks; the 21-file count comes from the runner/testResults file list.

Additional checks passed without warnings/errors:

```text
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js lib/server/reconciliation tests/reconciliation-persistence
node scripts/verify-server-boundary.mjs
git diff --check
```

Migrations 001–004 were compared against HEAD with line-ending normalization and are unchanged. Actual source-file SHA256s:

| File | SHA256 |
| --- | --- |
| db04-001-reconciliation.sql | 6e0b3e2e4348d6b24f99aceb5dae84319c5cb3d95a5258b2cd6957481b5d15ae |
| db04-002-reconciliation-security.sql | 7e5d6a3e6ca4432977d7a411f26541d3fe0dfe347c1d6ffc4b07b5c108bfd5e6 |
| db04-003-ranking-evidence.sql | 803776e8b32d08cfd244a6576cc29f81222e55c1dfad7d126d07fb3d73fd77eb |
| db04-004-proposal-verification.sql | a67546d385bcd713918e94f8d5e31a06f3fb4fd6bfd035608a870733ba41bc36 |

Raw attempt logs and final machine-readable results are retained under ignored `.local/reviews/gpt-native-20261112/` and included in the verified review ZIP with source hashes. No credentials, environment dumps, connection configuration files, database directories, raw source datasets or Git internals are packaged.

## Supabase readiness and remaining limits

**Ready for target-specific migration review; not approved for group execution.** Migration 005 passes local native PostgreSQL 18.6 enforcement and regression checks after the new-object ACL fix. No unresolved local test failure remains in the selected scope.

Before any group migration, separate approval must establish the group's actual PostgreSQL version, installed prerequisite/identity/audit contracts, owner/runtime separation, role inheritance, ACLs, target-specific issuer/authority configuration and recovery plan. Current app GPT entrypoints retain their local-only guards; this verification does not enable hosted routes or provider dispatch. The existing FYP-A-specific identity SQL/configuration was inspected as source only and was neither executed against FYP A nor repurposed for the group.

This minimal schema still stores only completed, schema-valid proposal evidence. Raw response replay, provider failures, durable dispatch reservations and cross-process inference budgets remain outside it. Content hashes are integrity links, not provider attestations. No automatic approval/financial posting/decision overwrite is introduced. The excluded browser journey, recovery-lab suite, full application build and actual hosted principal/catalog remain unverified in this step.

Stop here. Group Supabase migration and any hosted action require separate approval.
