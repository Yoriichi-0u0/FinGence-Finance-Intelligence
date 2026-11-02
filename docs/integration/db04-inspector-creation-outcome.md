# Approved personal FYP A inspector creation: rejected and rolled back

Subsequent update: the owner separately approved the one-time ACL diagnostic.
It completed read-only and identified two PUBLIC statistics-view SELECT grants.
See the [sanitized result and new, unexecuted role proposal](db04-statistics-inspector-proposal.md).
The original rejected role transaction below was not rerun.

On 2 November 2026 the owner approved only the reviewed inspection role SQL,
private password provisioning and subsequent restricted catalog inspection.
Starting commit: `011f637472ba5b42467dfdd8213e7a5ce410f89c` on
`feature/db04-ai06-supabase-celester`; no other branch was checked out or modified.

## Actual hosted execution

Target: personal FYP A `fhipzomczevbpybezzxu`, database `postgres`.
The existing securely configured personal-project owner connection was used
solely for the approved provisioning transaction, never as the catalog inspector.
The script checked the declared reference, exact direct host, port 5432, database,
owner role and mandatory certificate validation. An identity query confirmed
database `postgres`, role `postgres`, active SSL and no existing inspector role.
No passwords, URLs, CA contents or tokens were printed, copied into chat or committed.

The exact SQL file's SHA256 matched the reviewed approval document:
`8bf65033a1114de4daaf8f314792750d81dde41072bcd20d80f442e7c357514e`.
The approved file was not edited. That transaction alone was submitted.

The server returned SQLSTATE `42501` with the exact guard exception
`INSPECTION_ROLE_UNSAFE_PUBLIC_PRIVILEGES`. A separate ROLLBACK was acknowledged.
COMMIT was not acknowledged and the transactional role creation/settings/CONNECT
grant were rolled back. No durable inspection login was created. No password was
generated or provisioned. No retries or weaker role/grant alternatives were used.
No existing roles, grants, RLS, tables or financial records were changed.
No additional hosted diagnostic was executed after the rejection.

Machine-readable safe evidence: `db04-inspector-creation-result.json`.
The one-shot local execution helper is ignored under `.local/`; it contains no
credential literals and reads the existing personal configuration privately.

## What the rejection establishes

The approved guard found at least one unsafe effective privilege for a newly
created role. Its combined condition covers PUBLIC table/column rights, schema
CREATE, or accessible PUBLIC-callable non-trigger SECURITY DEFINER functions.
It does not return which condition/object caused the exception. Do not guess the
offending grant or infer that financial contents were publicly exposed. That
requires a separate metadata diagnosis. Nothing here establishes RLS bypass or
successful financial access; no financial SELECT was attempted on hosted FYP A.

## Compatibility status

| Component | Actual evidence and outstanding requirement |
| --- | --- |
| Connectivity | Real personal-project TLS connection and owner identity verified for approved provisioning only |
| DB01 | Prior dashboard schema diagram showed four foundation tables; full restricted catalog report not available |
| DB02 | Warning-fence/index/constraint/permission enforcement on hosted target not yet verified |
| DB03 | Backup/recovery evidence remains required; dashboard label alone cannot prove recovery capability |
| DB04 | Hosted schema, M2/M3 identity compatibility, migrations, runtime RLS and financial write/read remain unverified |
| Ingestion | Local registered CashSource path works; general C1/V2 still lacks proven cash classification/VALUE_DATE/ownership bridge |
| AI06/API/views | Existing local implementation unchanged; no hosted reconciliation, authentication, API or five-view result claimed |

## Exact next plan, not executed

1. Keep the failed provisioning stopped. Do not edit or rerun the approved SQL,
   revoke PUBLIC grants, change existing objects, disable RLS or provision a password.
2. If separately approved, run only
   `supabase/sql/db04-inspector-public-diagnostic.sql` on the same personal target.
   This is a one-time, explicitly scoped owner ACL diagnosis because no restricted
   login exists. It is not a substitute for the DB01--DB04 inspector. The transaction
   is READ ONLY and returns only object/schema/column names, PUBLIC privilege types
   and categories from pg_catalog. It reads no application, financial, session or
   audit rows and invokes no user-defined functions. No secrets/function bodies are
   returned. Its complete SQL must be reviewed before approval.
   Reviewed working-file SHA256:
   `588b4f2921cfec9fec75798af3e0bed3f222cc52a3223cc35e0059681d9f8837`.
3. Based on those actual findings, prepare object-specific remediation with an
   impact analysis and separate approval. There is no approved ACL repair now.
   A role-specific REVOKE cannot remove rights received through PUBLIC; do not
   misrepresent it as a safe repair or make broad revocations without review.
4. Only after separately approved remediation and reauthorized provisioning can
   the independent password be entered privately, the ignored inspection file be
   completed and the existing restricted metadata preflight be run.
5. Build the target-specific DB04 migration/ownership/identity plan from that
   report and verified recovery evidence. Existing DB04 001--004 and M2/M3
   checksums are references, not approval to bootstrap local auth on Supabase.
   No DB04 hosted changes, financial writes or API enablement are authorized now.

The diagnostic is tested only on disposable local PostgreSQL with deliberately
created synthetic PUBLIC column and elevated-function privileges. Those fixtures
are removed locally after verification. No hosted findings are invented from them.

Final affected local suite: **112 passed, 0 failed, 0 skipped**, including **31
native PostgreSQL tests** with real installed offline E5 enabled. Raw local report:
`outputs/db04-ai06/public-acl-diagnostic-local.json`. The new test verifies exact
column/elevated-function findings and that only the five approved metadata fields
are returned. Existing persistence, rollback, restricted RLS, unresolved evidence,
reconnection and live five-view tests remain in the same suite. These counts do
not include a successful hosted inspector test. The full project was not rerun;
the earlier 30 unchanged-main failures remain disclosed.
