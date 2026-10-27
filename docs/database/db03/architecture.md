# DB03 backup architecture assessment

Reviewed 27 October 2026 at `3637faa10fd1f42304d983ff5be420e9ec72dea8`. The local branch and upstream were `feature/backend-api-celester` / `origin/feature/backend-api-celester`, with a clean initial working tree. Reviewed the SQL chain, DB02 report, pg adapter, grouped writer/investigation contracts, financial fixtures and existing native test infrastructure. No environment file, hosted Supabase account or existing database was inspected.

## Recovery scope and invariants

The approved schema chain is `phase1-clean-setup.sql` → `c3b1-grouped-persistence-upgrade.sql` → `db02-001-warning-mutation-fence.sql`. The alternative original-schema/source-file-upgrade path remains documented and covered by existing compatibility regressions; the separate source-file upgrade must not be applied over clean setup.

| Recovery object | Required evidence |
| --- | --- |
| persistence_attempts | Exact UUIDs, dataset counts and timestamps; no uncommitted/rolled-back attempt |
| ingestion_batches | Group relationships, producer/dataset identities, statuses/counters, completion times and source-file metadata; COMPLETED_EMPTY retained |
| financial_records | Every stored column, exact NUMERIC and NULL, both source dates/canonical basis, monetary basis, currency origin, account/source identifiers and file/sheet/row/hash lineage |
| validation_issues | Exact owning record/ordinal, category/severity, warning evidence and provenance |
| Database structure | Columns/defaults, PK/FK/unique/CHECK definitions, validation/deferral state, indexes, function definitions/owners/ACLs, enabled triggers including DB02-001, public-schema ownership, extension ownership, RLS and policy definitions |

Backups preserve the committed database state; they do not repair an already inconsistent state. Writer recounts and grouped atomicity remain application guarantees. PostgreSQL still enforces monetary/date/FK checks and warning consistency; DB02-001 serializes competing issue mutations. Restored data is independently audited for counts, warning evidence, filenames and orphans. No new count/lifecycle rule is introduced by recovery tooling.

## Method comparison

| Method | Recovery unit and capability | Limits |
| --- | --- | --- |
| Logical custom archive | A consistent database export, restored as database objects and data; useful for selective logical reconstruction | Cluster-global roles are not part of pg_dump. Cannot replay subsequent WAL as PITR. External files, keys and service configuration need separate recovery |
| Physical base backup | PostgreSQL cluster files plus required WAL; whole-cluster recovery with compatible native binaries | Not a selective table restore or a universal cross-version/cross-platform migration format. A manifest check must be followed by a real startup and data verification |
| Base backup + archived WAL | Replay through a selected supported recovery target | Requires the necessary continuous WAL chain and suitable recovery configuration. Cannot recover transactions beyond the retained recoverable chain or undo arbitrary external effects |

These method properties are documented by PostgreSQL's [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_basebackup](https://www.postgresql.org/docs/18/app-pgbasebackup.html) and [continuous recovery](https://www.postgresql.org/docs/18/continuous-archiving.html) manuals. DB03's results concern the tested local schema, tools and synthetic dataset, not a production capability certification.

## Ownership and privileges

The source and logical target have the same explicitly provisioned local `db03_owner`, `anon` and `authenticated` roles. The latter two are NOLOGIN test roles. The target is a new database in a second freshly initialized cluster. No `--no-owner`, `--no-acl`, `--clean` or constraint-disabling workaround is used. The existing plpgsql extension is initialized by PostgreSQL; extension version/schema/owner is compared after restore.

Logical restoration changes the catalog representation of the four default table ACLs from an explicit owner-only array to NULL/default. DB03 retains both raw representations in evidence, resolves NULL using PostgreSQL `acldefault`, and compares the resulting ACLs. Table/function/schema ownership and privileges are checked; actual SELECT attempts as anon/authenticated fail with 42501 on each recovered database. This is verified effective-permission equivalence, not a claim of byte-identical logical catalog storage. Physical recovery retains the original raw ACL representation.

## Native laboratory versus managed Supabase

This laboratory controls fresh native cluster directories, binaries, local roles and WAL settings. A managed backup has provider-defined scope, access, retention, procedures and account-specific availability. None of those settings, entitlements or subscription capabilities was queried or assumed. Native test success does not establish hosted Supabase RPO/RTO, restore eligibility or physical/WAL access.

The scope is the finance persistence database and its tested schema. It does not recover uploaded source-file bytes that were never stored in these tables, object storage, application secrets, external services or an entire managed product. Production planning must inventory those dependencies separately.
