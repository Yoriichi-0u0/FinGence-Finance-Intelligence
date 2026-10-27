# DB03 restore integrity verification

Authoritative final run: [2026-10-27T10-32-36-772Z](evidence/2026-10-27T10-32-36-772Z/recovery.json). Its [Vitest report](evidence/2026-10-27T10-32-36-772Z/vitest.json) passed 548 tests across 22 files, with no failures or skips. DB03 contributes 24 native recovery tests and 10 safety/history tests; the remaining 514 are the existing selected API/persistence/DB02 regressions, including 25 native DB02 cases. These are real PostgreSQL 18.6 executions, not PGlite concurrency claims.

## Dataset and comparison

Synthetic inputs reuse the repository's ingestion fixture helper and unchanged grouped persistence service. Fixed CSVs, context timestamps and attempt IDs provide signed-source, debit/credit-ledger and directed-source monetary bases, VALID/WARNING records, duplicate source business IDs, warning evidence, missing currency/balance fields, independent dates and source lineage. An all-rejected child becomes COMPLETED_EMPTY; rejected records are excluded from financial_records. Database-generated batch/record/issue UUIDs and creation/completion times vary between runs; their exact values must survive within a backup/restore comparison.

| Checkpoint, before subsequent write probes | Attempts | Batches | Financial records | Issues |
| --- | ---: | ---: | ---: | ---: |
| Initial committed source | 1 | 4 | 4 | 4 |
| Logical restore | 1 | 4 | 4 | 4 |
| Physical base recovery | 1 | 4 | 4 | 4 |
| Before-target source checkpoint | 2 | 5 | 5 | 4 |
| PITR at the named boundary | 2 | 5 | 5 | 4 |

All four tables are compared as ordered full-row `to_jsonb(row)::text` results. NUMERIC tokens remain PostgreSQL text and are never parsed into JavaScript financial numbers. Evidence stores counts and SHA-256 fingerprints rather than exported row data. Every restored table fingerprint equals the appropriate source checkpoint, including identifiers, JSON metadata, timestamps, NULLs, source lineage and relationships. Independently executed DB02 audit queries return zero violations, and orphan checks return zero records/issues/batches.

Explicit monetary checks retain `9007199254740993.123456789`, ledger debit `9007199254740993.1`, credit `2.000000001`, exact net `9007199254740991.099999999` and balance `9007199254740999.123456789`. Missing balance/currency/origin remain NULL. The directed-source record keeps POSTING_DATE basis and canonical date 2026-09-03. A completed-empty batch remains present with a completion timestamp and zero accepted counts.

Namespace, table, function and extension owners, effective ACLs, column/default definitions, constraints, indexes, functions, enabled triggers, RLS flags and policy definitions compare equal. The [architecture assessment](architecture.md) explains the retained raw NULL/default ACL difference in logical restoration; permissions are not discarded. Negative warning/NaN mutations are rejected by the recovered database, and both test client roles remain denied.

## Physical recovery proof

`pg_basebackup` produced a plain full backup with streamed WAL, fast checkpoint and SHA256 file checksums. `pg_verifybackup` succeeded with WAL parsing enabled. Its original [backup manifest](evidence/2026-10-27T10-32-36-772Z/physical-backup-manifest.json) is retained byte-exactly as metadata; database files and WAL are not in this repository. A separate copy started successfully, reached a consistent base-backup endpoint, completed promotion, and passed full data/schema checks. Startup plus data verification, not merely the manifest check, establishes this result. PostgreSQL explicitly recommends such restore tests in its [verification manual](https://www.postgresql.org/docs/18/app-pgverifybackup.html).

## PITR boundary proof

The same pristine base backup precedes both marker groups. A real committed group `30000000-0000-4000-8000-000000000003` is followed by named restore point **db03_verified_boundary**, then a second committed group `30000000-0000-4000-8000-000000000004`. The source is confirmed to contain the later committed group; recovered investigation confirms the earlier group committed and the later group absent.

- Restore-point LSN: **0/B04798**.
- Recovered last replay LSN: **0/B04798**.
- Source WAL flush LSN after the later commit: **0/B079E8**.
- Recovered state equals the complete pre-target source snapshot and contains 5 accepted records.
- Recorded server log explicitly names the restore point and records archive recovery completion/new timeline 2.
- `pg_is_in_recovery()` is false after the readiness gate; the helper does not treat transient hot-standby readiness as completed recovery.

The source used `basic_archive` to retain completed WAL segments; the archive held 5 files totaling 4,194,639 bytes in this run. The generated Windows restore_command uses escaped, validated laboratory paths and PostgreSQL's own %f/%p placeholders. No user-supplied shell fragment or credential is accepted. The named target is PostgreSQL-supported [recovery configuration](https://www.postgresql.org/docs/18/runtime-config-wal.html#RUNTIME-CONFIG-WAL-RECOVERY-TARGET).

An intentionally rolled-back attempt `30000000-0000-4000-8000-000000000002` remains absent from all three recoveries. After snapshot and boundary verification, separate new writer probes ending in UUIDs 006/007/008 each commit one accepted record in logical/physical/PITR targets and are confirmed by investigation. Their later writes are labelled separately in evidence and are not confused with restored history. Existing transaction list/detail and batch list/detail/summary services also execute successfully using test-only scope/audit adapters; no security integration is implied.

## Negative paths and historical checks

Tests reject changed archive checksums before invoking restoration, truncated archives, an intentional restore-command role error, reused targets, existing destinations, corrupted physical data and a physical copy missing its manifest. Corruption uses separate disposable copies. The authoritative archive/base remain intact and are reverified. Spawn failures/timeouts cannot count as successful corruption detection.

Historical DB01/DB02 manifest checks read the exact Git blobs at the approved base commit, preserving byte-exact artifact hashes and documented LF-normalized source hashes. Two selected existing DB01 fixture/hash regressions also pass. In that filtered command the other two DB01 cases are not executed: its full performance matrix is intentionally not rerun, and its previously documented CRLF working-copy artifact check is handled through authoritative Git-blob verification, not weakened or rewritten. Those non-selected cases do not count as passes or as native recovery verification.
