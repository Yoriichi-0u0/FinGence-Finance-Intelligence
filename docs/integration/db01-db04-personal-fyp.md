# Personal FYP A: DB01–DB04 integration status

Start: 569d5df0598387e559b9fd7de8e811db493b8904.

Latest update: the separately approved inspector creation transaction reached
personal FYP A over verified TLS, failed its unsafe-PUBLIC-privileges guard and
was rolled back. No password or restricted catalog report exists. See the
[execution evidence and next approval plan](db04-inspector-creation-outcome.md).
The access findings below describe earlier preparation, not a successful inspection.
The separately approved one-time ACL diagnostic has since completed; see the
[sanitized findings and tested revised inspector proposal](db04-statistics-inspector-proposal.md).
No role or full restricted DB01--DB04 catalog report exists yet.

The owner authorizes catalog-only inspection of personal FYP A, which is a
development/testing project despite the dashboard's branch label. The separate
team Production project must not be accessed. No new project or paid service is
needed. Hosted role, grant, schema, auth and migration changes require a specific
target-verified plan and approval before execution.

## Actual access findings

The current process has no Supabase/database/inspection variables, Supabase CLI
or connector. Neither this worktree nor the known original checkout has .env
configuration. The ignored `.local/db04-inspection.env` template has now been
created with a protected Windows ACL limited to the current user and SYSTEM.
Its existing contents are preserved on repeated initialization. No
database name, inspection role or connection URL is configured. The owner has now
confirmed project reference `fhipzomczevbpybezzxu`; it is prepared in the private file.
An expanded workspace search subsequently found two neighbouring FYP-labelled
`.env.local` files with the same declared project reference. Both URLs identify
administrator accounts, with no dedicated inspection settings. Their credentials
were neither copied nor used. Personal-versus-team ownership of that reference
was subsequently confirmed by the owner. The open personal dashboard was inspected:
four foundation tables were visible in the schema diagram and no custom inspector
was listed in All roles. See [the target-specific approval plan](db04-personal-inspector-approval.md).
Therefore no hosted connection, catalog query, financial read/write, migration,
role/grant change or reconnect/security test was executed. Previous claims of
existing DB01–DB03 work are preserved but not reverified against the hosted target.

Run the helper in a private local terminal to enter only missing settings:

```powershell
pwsh -NoProfile -File scripts/db04-configure-inspection.ps1 -ConfigureMissing
```

The URL prompt is masked. The helper validates the direct personal project host,
declared role/database and TLS options, refuses unsafe permissions and preserves
nonempty settings. It never connects or creates a role. Reply `configured` after
private entry; never paste credentials into chat. Expected keys:

```text
DB04_INSPECTION_DATABASE_URL=<secure dedicated inspection connection>
DB04_INSPECTION_ROLE=<existing catalog-only login>
DB04_INSPECTION_DATABASE=postgres
DB04_INSPECTION_PROJECT_NAME=FYP A
DB04_INSPECTION_PROJECT_REF=<verified personal reference>
DB04_HOSTED_INSPECTION_AUTHORIZATION=FYP_A_READ_ONLY
```

Use DB04_INSPECTION_CA_CERT only if required by the approved TLS chain. The exact
direct host must be db.<personal-reference>.supabase.co:5432; the team reference,
an inferred reference or an unbound pooler alias is not acceptable.

```powershell
node --env-file=.local/db04-inspection.env --conditions=react-server scripts/db04-readiness.mjs inspect
node --conditions=react-server scripts/db04-readiness.mjs plan
```

The first command is for use once the secure configuration is available, not a
record of a hosted run. If the inspection login does not exist, first provide the
confirmed role absence. A target-specific role/CONNECT plan is now prepared
for approval; this task does not create a hosted login or fall
back to privileged/application credentials. No financial SELECT or private-schema
USAGE grant is needed by the locally tested catalog inspector. The exact proposed
SQL is `supabase/sql/db04-inspection-role-review.sql`, a review template rather
than an install migration. It creates a nonprivileged login with CONNECT only,
read-only defaults and query/lock timeouts. It contains no password and fails on
an existing role. It must be bound to the verified project reference and separately
approved before any hosted execution. No hosted account existence is established.

## Implemented catalog compatibility evidence

The existing read-only preflight now inventories approved public foundation
tables: ingestion_batches, financial_records, validation_issues,
persistence_attempts and optional security_audit_events. It records column types,
numeric precision declarations, owner/ACL/RLS metadata, constraints, indexes,
policies, noninternal triggers and their function ownership/security settings.
Function definition_md5 is only a drift marker, not migration authentication or
financial provenance; bodies are not returned. Migration source checksums remain
SHA256 of exact reviewed files. No financial, session or audit row contents are read.

Grouped persistence and DB02 warning-fence markers are explicitly presence
observations, not proof that a migration version is installed. Fence enabled state
is separate, so a disabled trigger is not reported as active enforcement. Metadata
alone never proves existing data preservation or successful recovery.

DB03 inspection of the existing backend branch shows logical/physical backup and
restore/PITR engineering, not a new SQL table migration. Those historical results
were inspected read-only from Git, not merged, modified or rerun here. Actual
personal FYP A backup/restore evidence remains required; catalogs cannot prove it.
The Phase 3 security audit table is supplementary metadata, not DB03 recovery proof.

`plan` now separately lists SHA256 foundation references and labels clean/upgrade
alternatives REFERENCE_ONLY_NOT_AN_EXECUTION_SEQUENCE. Local M2/M3 dependency files
are not approved hosted authentication bootstrap. It never applies SQL. No
historical migration was rewritten. A concrete hosted execution sequence cannot
be approved until actual target metadata, ownership/grants, auth compatibility and
backup/recovery evidence are available.

## DB01–DB04 contract compatibility

The supported local path remains registered CashSource → DB04 atomic persistence
→ deterministic/fuzzy/real offline E5 evidence → independent unresolved proposal
verification → protected GET → all five financial views. Existing C1 VALID/WARNING
persistence and rejected-row exclusion remain separate and unchanged.

Direct C1 financial_records → DB04 reconciliation is still unsupported without
trusted BANK/LEDGER authority, VALUE_DATE provenance and organization ownership
binding. Source_system/filenames and generic transaction_date cannot supply those
facts. No reclassification, date substitution, fake V2 cast or accounting policy
was introduced. Numeric declarations and source/batch/record columns can be
inspected; a proven versioned mapping remains a required external contract.

Supabase Auth integration is not established: the local M2/M3 opaque sessions and
definer functions require an explicit hosted subject/membership/revocation/RLS
mapping. Existing local endpoints remain local-only. No team Production/Vercel
or frozen AI research changes were made.

## Verification

See outputs/db04-ai06/personal-fyp-catalog.json for the relevant regression run,
and personal-fyp-final.json for final focused tests. Native PostgreSQL validates
foundation/DB04 coexistence, exact numeric metadata, active DB02 markers, read-only
CLI inspection without financial SELECT, existing persistence, RLS, duplicate,
rollback/reconnection and live financial dashboard behavior. These remain local
results, not hosted DB01/DB02/DB03/DB04 integration evidence.

Relevant regression run: 688 passed, 0 failed, 14 existing skips. Final focused
run after the role-template test: 109 passed, 0 failed, 0 skipped, including 28
native PostgreSQL tests with the real installed offline E5 enabled. Runs overlap.
The proposed inspector role was created only inside the disposable cluster:
catalog inspection succeeds, financial SELECT and CREATE TABLE are denied.
The Windows helper was also exercised with synthetic settings: masked-input
configuration succeeds and a repeated run preserves the file without prompting.
The real private configuration remains incomplete pending owner terminal entry.
An initial sandbox test launch failed before collecting tests due to temporary
cache rename permissions; the successful run used the approved local execution.
The full project was not rerun; the earlier 30 unchanged-main failures remain
disclosed and no claim of a passing full project suite is made.
