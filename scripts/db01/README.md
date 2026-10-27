# DB01 local native PostgreSQL benchmark

From the repository root, run `node scripts/db01/run.mjs`. Requires installed project dependencies and native PostgreSQL binaries. On Windows, the default binary directory is `C:/Program Files/PostgreSQL/18/bin`; override only the binary directory using `DB01_PG_BIN`. No package installation or application environment loading occurs.

The launcher creates a uniquely named temporary cluster, reserves a loopback port, initializes an empty database, starts PostgreSQL, executes the benchmark and stops PostgreSQL in `finally`. It never connects to an existing database or reads a database URL. Trust authentication applies only to this disposable loopback cluster while running. Cluster files remain at the printed temporary path for investigation; no existing database is deleted or reset. Do not interrupt or kill the launcher during execution; if interrupted, stop only its printed cluster using `pg_ctl -D <printed-path>/data -m fast -w stop`.

Artifacts go to a new timestamped directory under `docs/database/db01/`. After success run `node scripts/db01/summarize.mjs docs/database/db01/<timestamp>` to produce index comparisons and plan summaries. Failure directories retain explicitly partial evidence and `failure.json`; do not interpret them as completed matrices.

The fixture generator accepts exactly 1,000, 10,000 or 100,000 accepted rows. Seed 20261027 drives dates. Each dataset contains 1,000 populated batches, 20% WARNING rows with one linked issue, MYR/USD/SGD/NULL currencies, all three monetary bases, both canonical-date bases, exact large NUMERIC amounts, and financial NULLs. No rejected records are inserted. Batch counters are calculated from child fixture rows. Source lineage is synthetic. This is database-valid test data, not an ingestion acceptance or financial realism claim. Grouped write probes separately use the real ingestion engine and unchanged grouped service.

Every variant reloads the same fixture with all constraints/triggers enabled; exactly one candidate index exists at a time. SQL is captured from existing transaction/batch service builders with test-only scope/cursor adapters and an empty recording database. Native PostgreSQL then executes that SQL directly. Thus timings measure database/client transfer, excluding authentication, audit, cursor signing and service projection. Existing integration regressions cover those service behaviors. Batch list/detail plans include their actual lateral warning aggregates.

Each of 384 read cases uses three warmups and 20 measured executions, followed by one separate EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON). Median is the mean of samples 10/11; p95 is nearest-rank sample 19. All raw samples, SQL and bind parameters are saved. Grouped probes use two datasets/100 accepted rows, three warmups and 20 measured acknowledged commits per variant. Cleanup occurs after timing in a separate transaction. Fixture load time includes generation, constraints, commit and ANALYZE and is diagnostic only, not a replicated insertion benchmark. Candidate grouped-write throughput provides the repeated write comparison.

Limitations: fixed variant order, single connection, warm cache, small sample count for tail latency, no cold-cache/concurrency/cloud equivalence, no write-ahead-log byte measurement or index-build timing. Distribution deliberately includes date ties and batch-correlated warnings/currencies, rather than modeling production selectivity. 1,000 batches with one row each at the smallest size prioritizes scope comparability. Re-run with randomized variant ordering and representative batch distributions before choosing a production migration. Raw plan trees expose index/sequential scans, shared buffers, sort methods/memory/disk and temporary blocks; `plan-summary.json` extracts them without double-counting child buffers.

Manifest verification uses the shared `integrity.mjs` implementation during generation and verification. `hashConvention` records SHA-256, `byte-exact` artifact hashing and `crlf-to-lf-v1` source hashing. Source normalization removes only the CR byte immediately before LF; it preserves lone CR, BOMs, whitespace, encoding bytes and final-newline presence. No source file is rewritten. All 389 artifact hashes remain byte-exact; do not normalize benchmark artifacts to fix a mismatch. Git's checkout line-ending conversion may change artifact bytes, so `--staged` verifies the actual Git blobs independently of the working tree.

```powershell
node scripts/db01/verify.mjs docs/database/db01/<timestamp>
node scripts/db01/verify.mjs docs/database/db01/<timestamp> --staged
```

Regression verification (native matrix skips unless launched):

```
node node_modules/vitest/vitest.mjs run tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/benchmarks/db01.test.ts --maxWorkers=2
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit --incremental false
```
