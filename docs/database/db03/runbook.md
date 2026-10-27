# DB03 local operational runbook

## Prerequisites and boundaries

Use this checkout on `feature/backend-api-celester`, with the approved DB02 commit in its history, installed project dependencies, Node 24 and native PostgreSQL 18.6 Windows tools. The runner defaults to `C:/Program Files/PostgreSQL/18/bin`; `DB03_PG_BIN` may explicitly select another installed binary directory. The source requires the installed `basic_archive` module. At least 1 GiB free temporary space is required. Git must be available at launch; the restricted test environment includes its standard Windows install directory.

This tooling accepts no database URL or existing restore destination. It creates new temporary clusters, local trust authentication on 127.0.0.1, and fresh target databases. It is a recovery laboratory, not a production backup command. Never repoint it at hosted Supabase or an existing user database.

## Repeat the verification

From the repository root:

```powershell
# DB03 native recovery/safety tests only
node scripts/db03/run.mjs

# DB03 plus required API, persistence, DB02 and grouped integration regressions
node scripts/db03/run.mjs --regressions

# Static/schema verification
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/db03/native.mjs scripts/db03/run.mjs scripts/db03/verify.mjs scripts/db03/vitest.config.mts tests/recovery/db03.native.test.ts tests/recovery/db03.safety.test.ts tests/recovery/verification.ts
node tests/persistence/schema-compatibility.mjs
git diff --check

# Only after reviewing new evidence: generate/verify this phase's integrity manifest
node scripts/db03/verify.mjs --write-manifest
node scripts/db03/verify.mjs
```

Each run creates a new timestamped evidence directory. `--write-manifest` refuses to silently rehash changed previously recorded evidence. Raw evidence hashes are byte-exact; source/documentation hashes use the existing CRLF-to-LF convention. The DB03-only .gitattributes rule disables line-ending conversion for new evidence files; historical DB01/DB02 files and attributes are unchanged. After a separately authorized staging step, `node scripts/db03/verify.mjs --staged` checks actual index blobs. DB03 development does not stage or commit anything.

The Vite/Vitest configuration sets `envDir:false`. Subprocesses use argument arrays with `shell:false` and a small environment allowlist; PGPASSFILE/PGSERVICEFILE point to empty lab-created files. The runner does not read .env files, app credentials or default libpq credential files. Existing CLI regressions explicitly opt out of environment-file loading. All database pools use known loopback ports and verify their data_directory against the owned cluster. New directories/databases must not already exist; restore targets are single-use lab objects, and successful restoration never uses --clean/--no-owner/--no-acl.

## What happens internally

1. Create an owned temporary root/marker, isolated source and local archive directory; initialize the approved migration chain including DB02-001 and insert synthetic grouped data.
2. Run a confirmed rollback, capture the committed source fingerprint, and create a custom-format pg_dump archive plus SHA-256.
3. Initialize a separate logical target cluster, provision the three explicit test roles and restore into a newly created database with --exit-on-error/--single-transaction.
4. Take a plain pg_basebackup with streamed WAL/SHA256 manifest, run pg_verifybackup, then recover a separate copy to its earliest consistent endpoint.
5. Commit the before-target group, create the named restore point, commit the after-target group and switch/wait for the archived WAL segment.
6. Recover a second base-backup copy to that named point. Wait for actual promotion, then compare records/schema and prove inclusion/exclusion independently.
7. Run failure, privilege, query and post-restore writer probes. Stop all owned clusters and remove the successful lab root only after verification succeeds.

Source archiving uses PostgreSQL's [basic_archive module](https://www.postgresql.org/docs/18/basic-archive.html). PostgreSQL itself requires a shell restore_command: the generated Windows COPY command uses only fixed syntax, validated owned paths and its %f/%p substitutions; backslashes are escaped for postgresql.auto.conf. It is not populated with arbitrary caller shell input.

## Failure handling and diagnostics

Do not infer success from a zero verification utility exit alone, pg_ctl readiness or partial row counts. Review recovery.json, vitest.json, command exits, fingerprints, audit results and cleanup state. A spawn/timeout error fails even a negative-path test. Do not automatically retry uncertain persistence outcomes or reuse a failed restore target. A new invocation creates a completely new lab.

Failed labs are stopped and retained, with exact paths in recovery.json. Two development failures are intentionally retained outside the repository:

- `C:/Users/celes/AppData/Local/Temp/fingence-db03-run-XZJMLH/fingence-db03-MwTEEe`
- `C:/Users/celes/AppData/Local/Temp/fingence-db03-run-jkehat/fingence-db03-GRytkB`

They are stopped synthetic diagnostics, not approved recoverable backups. Inspect only these DB03-owned paths if investigation is needed. Any later cleanup must first verify their db03-owner.json marker, resolved temporary-root boundaries and stopped postmaster state; never issue a wildcard deletion of temporary PostgreSQL directories. If stop/removal fails, preserve the location and report the error instead of broadening cleanup. Do not delete unrelated temporary files, existing user databases or preliminary DB01 evidence.

## Production operating requirements — not implemented here

Before any real deployment, assign owners and approve recovery scope/RPO/RTO, retention and deletion, encrypted backup/WAL transport and storage, encryption-key custody/recovery, least-privilege access, independent/off-site copies, immutability if required, corruption/archiver-failure monitoring, restore-drill cadence, capacity, incident authority and application acceptance gates. These are requirements to design, not hardcoded periods or existing service guarantees. Protect manifests separately if they are to detect adversarial tampering; a checksum next to a writable backup is not independent authentication.

A managed Supabase recovery plan additionally needs verified account/provider capabilities and procedures. No entitlement, provider retention policy, PITR availability, hosted migration permission or production access was obtained in DB03. Keep that work separate from this local harness.
