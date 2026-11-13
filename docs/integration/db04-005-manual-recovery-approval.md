# Group 005 manual backup and restore — owner approval required

13 November 2026 · `feature/ai06-gpt-integration-celester`

**Status: awaiting group-owner authorization before exporting Production data. No backup, source connection, role export or restore has run.** Reuse the completed SQL Editor inspection; do not repeat general compatibility checks. Source: FinGence-Production / `zmtdozblpvtjniehwjrw` / main / postgres, observed PostgreSQL 17.11.

## Concrete proposed authorization scope

Export a single consistent custom-format logical archive of these three schemas, including all their definitions and data:

- `fingence_reconciliation`: eleven existing DB04 tables, records, deterministic decisions, E5/fuzzy evidence, verification, reviews and audit.
- `fingence_db04_group_synthetic`: identity/membership/session dependencies needed by DB04 FKs and protected audit functions. Treat even synthetic identity/session material as sensitive.
- `public`: ingestion/financial foundation and any other public-schema objects/data within the approved snapshot. The owner must approve the whole public schema; no silent assumption that it still contains only four foundation tables.

Retain owners, ACLs, policies, ENABLE/FORCE RLS, constraints, indexes, sequences/defaults, triggers and routines. Do not use --no-owner, --no-privileges, --disable-row-security, --enable-row-security or filtered-row exports as a shortcut. pg_dump's normal row-security handling must fail rather than silently omit protected rows if the owner-approved backup identity cannot export them.

Also export role definitions/memberships/configuration using official pg_dumpall --roles-only --no-role-passwords. This is global **role metadata only**, not all databases' data. It may include managed role attributes/settings and must be treated as sensitive. No database role password/verifier, connection password, Supabase API key, JWT signing secret or private encryption key is to be placed in backup logs/manifests/review ZIPs. Independently owned credentials remain in the owner's secret store. Do not reset source passwords.

This is a **scoped pre-005 application recovery backup**, not a complete Supabase project disaster-recovery image. It excludes managed auth/storage contents, Storage object bytes, Vault key material, platform configuration, Edge Function secrets and other schemas. If schema dependencies/restore reveal that an excluded object/data is required, stop and obtain expanded owner approval; never silently export Auth/other teams' data or skip a failing FK/ACL. Do not claim full-project or Auth/Storage recoverability.

Owner approval must cover local storage of these Production rows and their isolated restore, not just the network export. A validated encrypted, non-synced destination with owner-only filesystem ACLs and an owner-controlled recoverable encryption key is required before capture. No concrete secure destination/key has been supplied yet. `.local/` is Git-ignored, but Git ignore alone is not encryption or access control. No backup/dump/raw data may enter the ordinary review ZIP, Git, chat or cloud upload.

## Source/tool/connection controls

Installed official PostgreSQL tools: `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` and pg_restore.exe, version 18.6. Source observed 17.11. No Supabase CLI, Docker, age/gpg/7z executable or PostgreSQL 17 installation was found on PATH/in the checked PostgreSQL installation directory. No installation/download is authorized or performed here.

Use an explicitly owner-approved export identity and private password file/secret mechanism, pinned direct group host `db.zmtdozblpvtjniehwjrw.supabase.co`, port 5432 and database postgres. Verify-full TLS with the group's trusted CA is mandatory. No inherited URL/service/host defaults, personal project configuration, SQL Editor data export, inspector credentials, runtime/broker fallback, access grant or RLS change. An owner-operated backup identity is distinct from the earlier catalog inspector role. If an owner cannot provide authorized export access, stop; dashboard access does not provide a PostgreSQL password.

Password handling: no credential in command arguments, SQL Editor query text or recorded terminal output. Use a temporary private PGPASSFILE or owner-managed secret reference, check owner-only ACLs, and unset inherited PostgreSQL connection/service/password variables before setting explicit approved values. --no-password makes unattended authentication fail rather than hang or reveal prompts. Never display/copy its contents.

## Review-only command specification — NOT executed

These commands describe the intended binaries/flags. Placeholders must be resolved privately; do not run them until the owner approval and protected-storage gate are satisfied. The future executor must use shell-safe argument arrays and capture logs privately without echoing secrets. Source TLS/environment must be set explicitly, including PGSSLMODE=verify-full, PGSSLROOTCERT and private PGPASSFILE.

```text
pg_dump.exe
 --host=db.zmtdozblpvtjniehwjrw.supabase.co --port=5432
 --username=<owner-approved-export-login> --dbname=postgres --no-password
 --format=custom --quote-all-identifiers --lock-wait-timeout=5s
 --schema=public --schema=fingence_db04_group_synthetic --schema=fingence_reconciliation
 --snapshot=<approved-shared-snapshot-id>
 --file=<protected-encrypted-storage-staging>/group-005.dump

pg_dumpall.exe
 --host=db.zmtdozblpvtjniehwjrw.supabase.co --port=5432
 --username=<owner-approved-export-login> --database=postgres --no-password
 --roles-only --no-role-passwords --quote-all-identifiers
 --file=<protected-encrypted-storage-staging>/roles-no-passwords.sql

pg_restore.exe --list <private-archive>/group-005.dump
pg_restore.exe --file=<private-review-file> <private-archive>/group-005.dump
```

The last command renders archive SQL for **private offline review only**, never executes it. Dump/restore code can run source-defined routines at the isolated destination; inspect security-definer code, event triggers, extensions and executable restore contents first. No raw SQL/records are printed into chat or packaged as review evidence.

Capture database/schema/data in one pg_dump archive to preserve one snapshot. For verification, hold a read-only repeatable-read control transaction and export its snapshot; pg_dump uses that exact snapshot. In the same source snapshot, compute per-table counts and order-independent SHA256 digests over canonical row hashes, plus sequence/state metadata and relevant owner/ACL/RLS/routine definitions; report only sanitized validation status/counts/hashes, never row contents. This validation reads Production data and is part of the approval scope, not a catalog-inspection extension.

Coordinate an owner-approved quiet capture window: no schema/role/grant changes; sequence changes and writes near the snapshot must be accounted for. Role export is separate from the database snapshot and cannot be claimed atomically synchronized with it. Record snapshot time, role capture time and any drift; fail on inconsistent authority/schema capture rather than accepting an incomplete backup. pg_dump uses ACCESS SHARE locks and may wait for DDL; stop on lock/authentication/TLS/RLS errors instead of weakening controls.

## Isolated restore and verification

Use a **fresh local loopback-only cluster**, separate from every existing local database and all Supabase endpoints. It must accept only 127.0.0.1, use SCRAM authentication and owner-only directories on approved encrypted/non-synced storage. Do not reuse the historical synthetic test harness's initdb -A trust setting for real rows. Generate a new local recovery-admin secret through the approved private mechanism; do not alter any source credential. Imported source roles have NULL passwords from --no-role-passwords and must not be enabled with usable credentials or network access. No real provider/API calls, public web app, email/webhook worker or Supabase platform service runs against the restored data.

The installed target candidate is PostgreSQL 18.6. Owner must explicitly accept a local PostgreSQL 18 restore as the isolated recovery destination; that proves recovery into 18, **not** in-place rollback onto source PostgreSQL 17.11. If matching-major recovery is required, an approved PostgreSQL 17 runtime must be supplied/provisioned before the restore. No software provisioning is silently authorized by approving data export.

Restore sequence, only on the ownership-marked fresh local cluster:

1. Hash/verify and privately inspect the archive TOC and rendered SQL, role file and dependency scope. Unexpected external dependencies/executables stop the restore for review.
2. Provision required role metadata first on that new cluster, retaining identity names, owner relationships and grant semantics. Never replay globals onto an existing cluster. Existing predefined/managed role conflicts or platform-only attributes are blockers, not permission to blindly ignore SQL errors, weaken grants or drop existing roles. Keep an explicit immutable mapping if any local-only platform stand-in is later approved; such a restore is not an exact managed-platform replica.
3. Create a brand-new empty recovery database, then run pg_restore with **--single-transaction --exit-on-error**, preserved ownership/ACLs and **without** --clean, --create, --no-owner or --no-privileges. Pin only localhost and the new port/database. Never substitute a remote URL on failure.
4. Require all schema/data/post-data stages to complete with zero unreviewed errors; validate expected constraints/FKs/indexes, routines, triggers, forced RLS, policies, sequences, owners and effective grants, including the group actor/session-grant chain.
5. Match every approved source-snapshot table's count and canonical SHA256 digest against the restored table; compare ownership/ACL/RLS/definitions and sequence coverage. Validate duplicate-sensitive digests without logging row values. Exercise restricted-role isolation only on this local restore, preserving real records; use read-only denial/metadata checks rather than modifying source or restored financial records.
6. Prove encrypted archive decryptability and SHA256 equality before restore. Record encrypted/plain archive hashes, sizes, TOC hash, tool/source/target versions, snapshot/capture times, role file hash, restore duration/exit status, per-table verification status and safe recovery instructions in a sanitized manifest. Secret keys, raw dumps, data directories and raw error rows stay out of it.
7. Stop the isolated cluster, preserve encrypted backup and required private keys per owner retention policy, and make no automatic destructive cleanup of sole copies. Temporary plaintext/data-directory cleanup requires the owner's approved retention/secure-cleanup policy; do not claim overwrite deletion guarantees on SSDs. Do not delete the only verified backup.

Success requires a real restore of the owner-approved Production export and its integrity/security comparisons. Listing the TOC, historical synthetic tests, a zero-byte archive or an error-tolerant partial restore does not resolve the blocker. The scoped archive's data is consistent as of its recorded snapshot, not a zero-RPO copy of later Production writes. Owner must accept retention/RPO/RTO and the limitations above.

## Migration handoff after successful recovery — do not execute now

Candidate: `supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql`
SHA256: `e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e`.

If and only if the approved export/isolated restore and all comparisons succeed, record **READY_FOR_DEPLOYMENT** for this exact candidate and target. Retain the already completed compatibility findings; do not start another general inspection cycle. Reuse `supabase/tests/db04-005-group-postdeployment-catalog.sql` after a separately approved migration.

Next deployment task must explicitly approve the same target/hash, an appropriate owner/executor identity, maintenance window and bounded lock/statement timeouts in its exact execution batch. Apply the single group-target 005 transaction only; never reinstall 001–004, original local 005, test fixtures, role/seed files or backup data. No --clean/full restore is part of migration. Stop on failed or uncertain COMMIT; never blindly retry. Recovery of Production itself would be a new coordinated approval because replaying a backup can overwrite teammates' newer data. No deployment occurs in this task.

## Sources and current result

Official PostgreSQL pg_dump: https://www.postgresql.org/docs/18/app-pgdump.html
Official PostgreSQL pg_dumpall: https://www.postgresql.org/docs/18/app-pg-dumpall.html
Official Supabase backup/restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

pg_dump archives contain single-database schema/data/ACLs, but global roles require a separate export. --no-role-passwords excludes role passwords, not all sensitive role settings. Supabase's default CLI dump excludes managed schemas, and database backups do not include Storage object bytes; neither fact should be hidden behind a full-project-recovery claim.

**Current result: AUTHORIZATION REQUIRED. Backup integrity: NOT YET MEASURED. Restore outcome: NOT RUN. No Production data exported. READY_FOR_DEPLOYMENT is not yet justified.**
