# DB03 — backup and recovery engineering report

27 October 2026. **DB03's safe local implementation is complete and ready for engineering review and an eventual separately authorized publication.** No commit, push, merge, deployment, hosted database access or DB04 work has occurred.

Branch/upstream: `feature/backend-api-celester` / `origin/feature/backend-api-celester`. HEAD remains `3637faa10fd1f42304d983ff5be420e9ec72dea8`. Initial Git status was clean; the earlier branch naming correction was intact. All work is new material under scripts/db03/, tests/recovery/ and docs/database/db03/. No tracked application component or existing migration was modified.

## Implementation

- [Architecture and recovery scope](architecture.md): current four-table schema, constraints, indexes, functions/triggers, owners/ACLs, RLS, grouped persistence/investigation and the logical/physical/PITR distinction.
- [Local runbook](runbook.md): reproducible Windows runner with fresh-resource guards, restricted environment, diagnostics and production decisions still required.
- Logical custom pg_dump archive, SHA-256 verification and strict single-transaction pg_restore into a second freshly initialized cluster/database. Required local roles are explicit; no ownership/ACL suppression is used.
- Physical pg_basebackup with streamed WAL and SHA256 backup manifest; pg_verifybackup followed by startup and financial/schema verification of a separate copy.
- PITR using basic_archive, a named restore point between committed groups, explicit promotion readiness, exact checkpoint comparison and included/excluded attempt proof.
- Native recovery/failure/contract tests, full-row string fingerprints without financial-number coercion, effective and raw ACL evidence, post-restore writes, and portable source/byte-exact evidence manifests.

No new production SQL migration is needed. The existing DB02-001 migration is included in every DB03 source schema and recovered with its active trigger.

## Final verified results

The authoritative run is [2026-10-27T10-32-36-772Z](evidence/2026-10-27T10-32-36-772Z/recovery.json); [548 tests passed across 22 files](evidence/2026-10-27T10-32-36-772Z/vitest.json), with **zero failures and zero skips**. This consists of 34 new DB03 tests (24 native recovery cases and 10 safeguards/history cases) plus the existing 514 selected regressions, including 25 native DB02 cases. Thus 49 native PostgreSQL cases passed across recovery and existing integrity/concurrency coverage. Native PostgreSQL 18.6 Windows binaries were used; PGlite coverage is labelled as such in the existing suites.

Logical and physical recovery each reproduce 1 attempt, 4 batches, 4 accepted records and 4 warning issues with full-table fingerprints equal to source. PITR reproduces the before-target checkpoint of 2 attempts, 5 batches, 5 accepted records and 4 issues. All restored audits and orphan checks are zero. Exact large NUMERIC values, NULLs, warning evidence, completed-empty state, duplicate source identifiers, dates/bases, source lineage and group identities survive. Schema definitions/owners/effective ACLs/RLS/triggers compare equal; actual client-role reads are denied. The raw default-ACL representation difference is explicitly documented, not hidden.

The named boundary is **db03_verified_boundary at LSN 0/B04798**, with replay stopped at that same LSN and recovery completed/promoted. The source's later commit reaches LSN 0/B079E8. The pre-target attempt is present, the post-target committed attempt is absent, and the rolled-back attempt is absent in all recoveries. Server-log evidence and full snapshot hashes support the boundary; server startup alone is not treated as proof. New grouped write probes commit successfully only after these checkpoint assertions. See [detailed verification](restore-verification.md).

| Final local measurement | Result |
| --- | ---: |
| Logical backup | 247.245 ms; 34,978 bytes |
| Logical restore / restore plus verification | 178.337 / 218.288 ms |
| Physical backup / manifest verification | 2,301.987 / 299.392 ms |
| Physical backup size | 26,468,925 bytes, 995 files |
| Physical recovery / plus verification | 5,091.393 / 5,146.808 ms |
| PITR recovery / plus verification | 4,724.247 / 4,813.868 ms |

[Measurements and checksums](measurements.md) define the timing boundaries and limits. These single-machine, tiny-fixture timings are not production or hosted Supabase RPO/RTO promises.

## Failure paths and development history

Separate disposable copies demonstrate checksum mismatch, truncation, malformed/incomplete physical backups and command failure. Restore failure is fail-closed and leaves no restored user tables; targets cannot be reused or supplied from an existing user database. Negative tests do not accept executable-launch errors/timeouts as successful corruption detection. Warning/NaN constraints reject invalid operations on recovered data. Original successful backups remain unchanged during corruption tests.

- First run [10-11-27](evidence/2026-10-27T10-11-27-675Z/vitest.json): PITR could not find WAL through the incorrectly encoded Windows COPY path and failed before the configured target; 21 recovery cases did not execute and do not count as passes.
- Second run [10-14-42](evidence/2026-10-27T10-14-42-174Z/vitest.json): 26 passed/5 failed while tightening verification. Corrections concerned equivalent default ACL representation, a reserved SQL alias and Git missing from the restricted PATH. They did not alter restored data or privileges.
- Later successful runs validated these corrections; final checks additionally cover namespace/extension ownership, explicit promotion completion and successful new grouped writes. The final authoritative suite above supersedes development failures, which remain available as evidence.

Successful labs were stopped and deleted only through their owned temporary-root checks. The two failed labs remain stopped outside the repository at the exact [runbook locations](runbook.md). No raw custom archive, database directory, WAL segment or credential is included in the repository. Retained physical backup manifests contain filenames/sizes/checksums only and are not restorable database backups.

## Complete verification and preservation

TypeScript, targeted lint, schema compatibility, selected DB01 fixture/hash tests, whitespace and evidence-integrity results are retained under evidence/. The selected DB01 command passes two tests; its other two cases are filtered out and are not counted as passes. The full DB01 performance matrix was not rerun. Historical DB01 (389 artifacts/14 sources) and DB02 (9 artifacts/10 sources) are checked against exact committed blobs, preserving their documented CRLF/LF distinction. No historical evidence or source is rewritten.

The DB03-only .gitattributes rule prevents future line-ending conversion of new byte-hashed evidence. [The integrity manifest](integrity-manifest.json) uses byte-exact SHA-256 for evidence and documented CRLF-to-LF hashes for source/documentation. Run `node scripts/db03/verify.mjs` to verify hashes and the authoritative run's restored snapshots, audit results, promotion boundary and physical-manifest checksum. A later authorized staging step can use --staged to verify index bytes.

The ignored 258 preliminary DB01 files and local exclusion rule are preserved. The untracked architecture assessment was absent at initial inspection and was not recreated. No production environment file or credential was read; no hosted Supabase or existing developer database was connected to. Test subprocesses use controlled local settings and dotenv loading is disabled.

## Remaining decisions and publication status

The [risk register](risks.md) separates tested safeguards from future operating requirements. SAIC/deployment owners still need to approve backup scope beyond these tables, RPO/RTO, retention, encryption/key recovery, access/off-site controls, monitoring, restore drills and provider-specific capabilities. Source uploads/object storage and external secrets/services are outside the proven recovery scope. DB03 does not resolve DB02's pending lifecycle/count mutation policies.

Ready for engineering review and eventual commit after explicit authorization; **nothing is staged or published by this phase**. Review the tooling, evidence and operational decisions before any production backup/deployment design. DB04 has not started.

New files comprise scripts/db03/native.mjs, run.mjs, verify.mjs and vitest.config.mts; tests/recovery/db03.native.test.ts, db03.safety.test.ts and verification.ts; and this documentation/evidence structure. No existing tracked file is modified.
