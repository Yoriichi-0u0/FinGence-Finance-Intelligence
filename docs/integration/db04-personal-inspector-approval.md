# Personal FYP A inspection login: pending approval

Historical proposal below. The owner subsequently approved the exact SQL, but
its hosted execution was rejected by the safety guard and rolled back. See the
[actual execution outcome and next approval boundary](db04-inspector-creation-outcome.md).
The approved SQL/checksum below is unchanged; no inspection login was committed.

Target confirmed by the owner: FYP A, project `fhipzomczevbpybezzxu`.
Observed in the already-open Supabase dashboard on 2 November 2026. The role
list's All roles filter showed the protected Supabase roles and only `postgres`
under Project database roles. No custom inspection login was listed. The managed
`supabase_read_only_user` is a protected service role, not a dedicated login to reuse.
No role creation, grants, SQL execution, financial row reads or hosted migrations
were performed. The separate team project was not opened.

The public schema visualizer displayed `financial_records`, `ingestion_batches`,
`validation_issues` and `persistence_attempts`. Visible financial columns included
numeric debit/credit/source_amount/derived_ledger_net/balance, date and provenance
fields. This UI evidence proves presence only, not exact typmods, enforcement,
data preservation, installed migration versions or runtime compatibility. The
overview displayed No migrations and No backups; this is not proof that manual
SQL was never run or external recovery backups do not exist. Full DB01/DB02
catalog validation, DB03 recovery evidence and DB04 prerequisites remain pending.

## Exact proposed change

Review the complete SQL in
[`db04-inspection-role-review.sql`](../../supabase/sql/db04-inspection-role-review.sql).
It is a proposal, not an automatic migration, bound to the above personal target
and database `postgres`. Its only new privilege grant is CONNECT to that database.
Reviewed working-file SHA256:
`8bf65033a1114de4daaf8f314792750d81dde41072bcd20d80f442e7c357514e`.
It creates `db04_catalog_inspector` with LOGIN, connection limit 1, no superuser,
BYPASSRLS, database/role creation, replication or inherited role membership.
Read-only transaction default, 10-second statement and 3-second lock timeouts
are defense in depth, not a substitute for ACL enforcement.

Before COMMIT it checks catalog privileges for existing non-system relations,
including column grants, schema CREATE, and accessible non-trigger SECURITY
DEFINER functions. If existing PUBLIC grants make the role too powerful, it raises
`INSPECTION_ROLE_UNSAFE_PUBLIC_PRIVILEGES` and aborts the transaction. The operator
must roll back and stop; this proposal never repairs grants, disables RLS or changes
other identities. It also fails if the role already exists. It grants no financial
SELECT, private schema USAGE, runtime role, Supabase Auth mapping or browser access.
Later object/grant changes still require revalidation by the inspector gate.

Supabase documents custom PostgreSQL LOGIN roles and the managed `postgres` role's
limited administration model. The SQL uses ordinary role/catalog operations and
has been tested locally; it has not been executed on managed FYP A. Managed
permissions or unsafe existing grants may still reject it. References:
[Supabase roles](https://supabase.com/docs/guides/database/postgres/roles) and
[managed superuser limits](https://supabase.com/docs/guides/database/postgres/roles-superuser).

## Private password and subsequent inspection

Only after separate approval for the exact SQL, an authorized owner can execute
it on the confirmed personal target. The role initially has no password. Set a
strong independent password privately using `psql`'s `\password db04_catalog_inspector`
masked prompt; never put a password in a dashboard query, command argument, SQL
file, chat or Git. PostgreSQL documents that `\password` avoids cleartext command
history and server logging: [psql](https://www.postgresql.org/docs/current/app-psql.html).
Password provisioning is part of the requested separate approval, not performed
by this task. Do not reuse the administrator password.

The ignored local file already has the confirmed nonsecret reference prepared;
existing settings and private ACL were preserved. Once the new/existing restricted
credentials are privately available, run the existing configuration helper and
catalog-only command. TLS certificate verification remains mandatory. The command
verifies actual database/role identity, denies privileged memberships and financial
table/column SELECT or write grants, and reads metadata only. No automatic fallback
to the locally found administrator connections is allowed.

If provisioning fails, no DB04 migration follows. If role creation commits but
password setup fails, the role remains without password authentication; do not
automatically retry creation or grant additional permissions. Removing a committed
role would require a separately reviewed change; never use CASCADE.

## Ingestion and deployment limits

Rechecked the available `lib/ingestion/models.ts`, V2 contracts and
`lib/server/ai-ingestion/v2-i1/persistence.ts`. C1 retains exact decimal strings,
VALID/WARNING acceptance, rejected-row exclusion, hashes and batch/source lineage.
V2 has sealed in-process verification, tenant/job/attempt/execution identity and
quarantine, with `publicationEligible: false`. A proposed `documentKind` does not
prove cash-account BANK/LEDGER authority. C1 canonical dates allow TRANSACTION_DATE
or POSTING_DATE; V2 semantic conventions require transaction_date. Neither exposes
the required verified VALUE_DATE cash contract. A safe bridge still needs approved
classification/version/authority, original debit/credit direction and account scope,
VALUE_DATE evidence, immutable source/record lineage and trusted organization and
batch-to-processing binding. Do not invent those fields or cast accepted V2/C1 rows.

Existing registered CashSource processing, fuzzy/E5, independent unresolved
verification, local RLS/API and five views are unchanged. No hosted DB04 migration
sequence can be approved until the restricted catalog report, hosted identity
contract and backup/recovery evidence exist. Frozen research remains unchanged.

## Local verification

Final affected suite: 111 passed, 0 failed, 0 skipped, including 30 native
PostgreSQL tests and the already-installed real offline E5 runtime. The role
proposal succeeds in the safe disposable catalog and denies financial reads and
DDL. Column SELECT escalation is rejected by preflight. Unsafe PUBLIC column
grants and PUBLIC-callable elevated functions each abort creation and leave no
role behind. Raw report: outputs/db04-ai06/confirmed-fyp-inspector-final.json.
Earlier intermediate run: 110 passed, 0 failed, 0 skipped (overlapping results).
No hosted test is included in these counts. The full suite was not rerun and
the previously disclosed 30 unchanged-main failures remain outstanding.
