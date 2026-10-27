# DB02 — integrity and lifecycle engineering report

27 October 2026. Base/HEAD: `91b20ea0087951eee147eb0d9f0c4665f7d94fb5`. Branch/upstream: `feature/backend-api-celester` / `origin/feature/backend-api-celester`. The earlier branch rename was already corrected at initial inspection. **Safe local DB02 implementation is complete and ready for engineering review. Nothing has been committed, pushed or deployed. DB03 has not started.**

## Implementation and findings

- Audited the actual schema chain, adapter, persistence contracts/validation/mapping/repository/grouped service, internal API query patterns and associated tests. See [safeguard inventory and enforcement matrix](integrity-audit.md).
- Documented the [lifecycle matrix](lifecycle.md) and tested current writer outcomes, shape-valid SQL transitions, completion timestamp/count checks and concurrent compare-and-set completion. Unapproved lifecycle/supersession decisions remain explicitly pending.
- Reproduced one native PostgreSQL warning-consistency race with a failing regression, then implemented [DB02-001](migration-review.md), one new versioned migration. Original SQL migrations and production TypeScript components remain untouched.
- Added PGlite lifecycle/financial checks, native rollback/concurrency/investigation/compatibility tests, a read-only count/provenance audit query and a focused warning-write overhead probe. Reused the existing native C3-B1 test cluster/adapter harness and synthetic producer fixtures rather than adding another database runner.

## Verified results

The final required regression command passed **514 tests in 20 files, zero failures and zero skips**. This includes **25 native PostgreSQL tests** and **32 new PGlite lifecycle/integrity tests**. Compared with the 465 existing selected tests, DB02 adds 49 cases (17 native and 32 PGlite).

| Verification | Actual outcome | Evidence |
| --- | --- | --- |
| Native defect reproduction on original schema | Expected red regression: 0 warning issues remained after two commits | [Baseline failed test](evidence/baseline-warning-race/vitest.json), [observation](evidence/baseline-warning-race/native-observations.json) |
| Existing API/persistence/grouped integration and new DB02 tests | 514 passed; 20 files; no skips | [Final Vitest JSON](evidence/verified/vitest.json) |
| Native PostgreSQL | 18.6, Windows x86-64; independent real connections, fresh disposable cluster | [Version/schema/trigger evidence](evidence/verified/native-environment.json), [native observations](evidence/verified/native-observations.json) |
| Competing warning removals | Loser rejected; 1 issue remains at READ COMMITTED, REPEATABLE READ and SERIALIZABLE | Native observations and test assertions |
| Competing record status / issue insertion | Real blocking observed; inconsistent issue commit rejected (23514), final VALID with 0 issues | Native observations |
| Mid-record, mid-issue and real deferred-COMMIT failure | Entire group rolls back; zero parent/batch/record/issue rows; fresh investigation confirms no commit | Native observations |
| Same attempt ID / distinct attempt IDs | Same ID commits once and duplicate rejects; distinct IDs progress independently | Existing/native assertions; distinct-ID observations |
| Duplicate dataset identity / repeated committed ID | Invalid group rejected before writes; repeated committed attempt adds no rows | Native and PGlite assertions |
| In-progress write investigation | UNRESOLVED while associated advisory lock is held; separate connection | Existing/native assertions |
| Real commit with lost service acknowledgement | COMMIT_OUTCOME_UNKNOWN, no automatic retry; primary investigation confirms committed data | Existing native test with actual COMMIT and deliberately suppressed acknowledgement |
| Failure before COMMIT transmission | UNKNOWN classification retained until primary investigation confirms no commit | Native observation |
| Backend termination / cleanup | ROLLBACK_UNCONFIRMED; primary investigation confirms no commit; healthy subsequent write works | Native observation; adapter unit regressions |
| Migration compatibility | Clean+grouped+DB02 and original+source-upgrade+grouped+DB02 paths pass; existing rows/RLS/grants preserved | Native compatibility case, PGlite migration tests, [existing schema checker output](evidence/checks.json) |
| Types, targeted lint, existing schema compatibility | Route generation, TypeScript, ESLint and compatibility checker exit 0 | [Check outputs](evidence/checks.json) |
| DB01 committed evidence | 389 byte-exact artifacts and 14 normalized sources verified by existing Git-blob verifier | Check outputs; no DB01 benchmark rerun |

Synchronization uses promise gates and observed `pg_blocking_pids`/advisory wait state, not a sleep-based assumption about transaction order. The original failing baseline forces both deferred checks to run before either deletion is visible to the other transaction. COMMIT uncertainty cases use explicitly labelled transport/acknowledgement injection around a real native database; they do not claim physical network packet-loss testing.

The focused native grouped-write probe uses 100 accepted rows/20 warnings and 20 measured commits per variant after three warmups. Median/p95 changed from **69.502/91.322 ms** with the new fence disabled to **73.901/104.319 ms** enabled. Fixed-order, single-machine results are descriptive; the approximately 6.33% median difference is not a production capacity prediction or isolated causal estimate. DB01 artifacts were not regenerated.

## Failures and limitations retained

The expected pre-fix race failure is retained as regression evidence. A first broad run had two overly specific test assertions expecting FK `23503` for RESTRICT; they were corrected to the actual RESTRICT `23001`, and the complete required suite was rerun successfully. [First-run evidence](evidence/first-verification.json) also records a **pre-existing DB01 working-tree artifact hash failure** caused by checkout CRLF conversion. DB02 neither changes nor weakens that test or its raw hashing. The already provided Git-blob verifier validates the authoritative committed bytes; all DB01 source/evidence files remain unchanged. This distinct checkout limitation is not presented as a passing working-tree test.

At initial inspection the architecture assessment was absent, with no untracked files shown; it was not reconstructed. Preliminary DB01 files and the local exclusion rule are preserved. No hosted schema, live production data, real financial files, production roles or recovery system was accessed. Legacy inconsistent rows are not automatically audited/repaired by installing the migration. High-contention multi-record deadlock patterns, long-term bloat/CDC effects and production rollout locking remain review limits.

[Workspace verification](evidence/workspace-verification.json) confirms unchanged HEAD/upstream, no staged changes, no DB01 tracked changes, and the identical combined SHA-256 digest of all 258 preliminary files. All 389 working-copy artifact differences from committed bytes are exclusively CRLF checkout conversions; the committed bytes match their original hashes. [DB02 evidence manifest](evidence/integrity-manifest.json) hashes the retained evidence byte-exactly and documents normalized source hashes using the existing shared DB01 integrity helper.

## Reproduce safely

From the repository root, with installed dependencies and local PostgreSQL 18.6 binaries (default `C:\Program Files\PostgreSQL\18\bin`, optional existing `FINGENCE_TEST_PG_BIN` override):

```powershell
# Choose a new evidence directory to preserve earlier runs.
$env:DB02_BASELINE='0'
$env:DB02_EVIDENCE='C:\absolute\new-evidence-directory'
node node_modules/vitest/vitest.mjs run tests/api tests/persistence tests/integration/grouped-consultation.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=path/to/new-vitest.json
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tests/persistence/grouped.postgres.test.ts tests/persistence/db02-native-cases.ts tests/persistence/db02.integrity.test.ts
node tests/persistence/schema-compatibility.mjs
node scripts/db01/verify.mjs docs/database/db01/2026-10-27T05-45-05-445Z --staged
git diff --check
```

Create the chosen evidence directory first. The existing native suite initializes its own fresh temporary cluster on an ephemeral loopback port, never uses application URLs, stops it, and removes only that exact verified temporary directory. If PostgreSQL binaries are absent the suite skips; do not interpret a skipped run as native verification. For defect reproduction, set `DB02_BASELINE=1`, use a separate evidence directory and run only `-t 'DB02 competing warning deletions READ COMMITTED'`; the assertion is expected to fail. Baseline mode is a **test-only** switch that omits DB02 migration installation, never a production setting.

## Review readiness and next step

Established integrity/lifecycle behavior and all required regressions are verified. One compatible safeguard is implemented as an unapplied migration candidate. [Remaining risks/decisions](risks-and-decisions.md) distinguish application-owned invariants and missing business semantics from verified defects. Approve/review the DB02 diff, migration costs/rollout and pending lifecycle/count policies before any commit or deployment. No new production-facing lifecycle rule was invented.

The next step toward DB03 is to obtain its approved scope and resolve the relevant producer/lifecycle/security decisions, then plan it separately. **Do not start DB03 as part of this work.**

Files created: `supabase/sql/db02-001-warning-mutation-fence.sql`, `tests/persistence/db02.integrity.test.ts`, `tests/persistence/db02-native-cases.ts`, and this report/evidence structure under `docs/database/db02/`. Modified: `tests/persistence/grouped.postgres.test.ts` only, to reuse its native setup, apply the candidate migration and register/persist DB02 evidence. No production TypeScript component or earlier migration was changed.
