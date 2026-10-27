# DB02-001 — warning mutation fence review

Candidate: [db02-001-warning-mutation-fence.sql](../../../supabase/sql/db02-001-warning-mutation-fence.sql). **Verified locally only; not applied to any existing user/hosted database.**

## Verified defect and correction

The original deferred warning checks independently counted issues without serializing concurrent changes. On fresh native PostgreSQL 18.6, two READ COMMITTED connections deleted different issues from one WARNING record. Both ran `SET CONSTRAINTS ALL IMMEDIATE` while the other's deletion was uncommitted, saw one surviving issue and then committed. Final issue count was zero. The regression assertion failed as expected; [baseline observation](evidence/baseline-warning-race/native-observations.json) and [failed test](evidence/baseline-warning-race/vitest.json) preserve the evidence. This is a violation of an existing database invariant, not an inferred business rule.

The additive migration creates one trigger function and one BEFORE INSERT/UPDATE/DELETE issue trigger. Each event updates the owning record's ingestion_status to its **identical value**, creating a real tuple version while keeping all stored column values unchanged. Reassignments fence both old/new parent IDs in sorted order. The new trigger sorts alphabetically before the existing source-file trigger, acquiring the parent mutation lock before the filename checker takes SHARE locks.

A plain SELECT FOR UPDATE would serialize READ COMMITTED work but would not by itself provide the same stale-snapshot write-conflict guarantee at REPEATABLE READ. The identical-value UPDATE deliberately creates that conflict. The original deferred checks and their timing remain intact. They queue additional record checks but never write records themselves, so there is no recursive trigger mutation cycle.

After the migration, the competing deletion test observes a real `pg_blocking_pids` dependency. Once the first transaction commits, the loser fails with `23514` at READ COMMITTED, or `40001` for the tested REPEATABLE READ/SERIALIZABLE schedules. One warning issue remains. A competing issue insert versus a record's transition to VALID also blocks and rejects its inconsistent commit. Coherent issue/status reassignment and group inserts still work. No automatic retry was introduced.

## Compatibility and safety

- Append after the existing clean+grouped chain, or original+source-file-upgrade+grouped chain. Both paths were verified locally; native alternate-path verification applied the migration over an existing populated WARNING record.
- Old financial, lifecycle and source-lineage values are unchanged by migration application. A subsequent warning edit is verified to retain financial-record column values. Native exact NUMERIC/NULL assertions and existing mapper/adapter tests also pass.
- No existing migration, index, table column, constraint, application service, pool deadline or API query is rewritten.
- The new function is SECURITY INVOKER with a fixed pg_catalog/public search path and explicit public table references; PUBLIC/anon/authenticated EXECUTE is revoked. Four-table RLS remains enabled. No new client grants or RLS policies are introduced.
- One-time versioned SQL matches the repository's manual migration style; there is no automatic registry or hosted execution in DB02. Reapplying the same CREATE FUNCTION/TRIGGER script is not an idempotent deployment operation.
- Applying the migration does not scan, repair or certify historical data. Run the read-only audit under separately approved operational access before rollout and explicitly review existing violations. No backfill/repair is included.
- CREATE TRIGGER needs a table DDL lock; production rollout needs a reviewed maintenance/lock-timeout procedure. Removing the trigger/function would reopen the demonstrated race and is not recommended as an automatic rollback.

## Cost and remaining concurrency limits

The fence adds one identical-value parent UPDATE per issue insert/delete/edit and up to two per reassignment, including extra tuple versions, WAL, deferred checks and vacuum work. All-record VALID-only insertion has no extra issue events. Multi-record transactions can still deadlock if they acquire unrelated records in different orders. PostgreSQL must abort a loser; this change makes no universal deadlock-free or automatic-retry claim. Logical replication/CDC and high-contention mutation workloads were not evaluated.

A focused native grouped-write probe (100 records, 20 warnings, three warmups and 20 measured commits per variant; cleanup excluded) compared the fence disabled/enabled in the disposable database. Median/p95 were **69.502/91.322 ms** versus **73.901/104.319 ms**, about +6.33% median in this single fixed-order comparison. [Raw samples](evidence/verified/native-observations.json) are retained. These are local observations, not causal production overhead or capacity predictions. DB01 results were not regenerated.

Production adoption remains a review/deployment decision. Local implementation fixes a proven invariant; it does not authorize hosted migration execution.
