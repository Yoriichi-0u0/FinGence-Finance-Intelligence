# Personal FYP A ACL diagnostic and revised inspector proposal

Historical proposal below: the owner subsequently approved the exact v2 SQL and
private password setup. Role creation and restricted inspection succeeded; see
[the actual hosted catalog result and next plan](db04-hosted-catalog-and-next-plan.md).
No DB04 migration or financial write was included in that approval or execution.

## Authorized execution, 2 November 2026

Started on `feature/db04-ai06-supabase-celester` at
`abf367d06b45c2eb172b2360255dc1dde7998d27`. The owner authorized one execution
of the reviewed read-only diagnostic on personal FYP A
`fhipzomczevbpybezzxu`, database `postgres`.

Verified the exact working-file SHA256
`588b4f2921cfec9fec75798af3e0bed3f222cc52a3223cc35e0059681d9f8837`,
its reviewed Git contents and the checksum in the approval plan. Verified the
private connection's exact direct host/reference, port, database and owner role,
mandatory TLS certificate validation, and actual database/role/SSL identity.
Submitted the unchanged diagnostic exactly once inside its READ ONLY transaction;
BEGIN and COMMIT were acknowledged. No retry, broader query or user-data SELECT
was used. No role, grant, RLS, function, table, authentication or financial changes
occurred. The failed role-creation SQL was not rerun; no password was provisioned.

Detailed rows remain in an ignored file with protected Windows ACL for the current
user and SYSTEM. They are excluded from Git and review ZIPs. The committed
`db04-acl-diagnostic-summary.json` contains only execution status and category counts.

## Sanitized finding and exact failure condition

The query returned two rows, both PUBLIC SELECT:

| Object | Privilege category |
| --- | --- |
| extensions.pg_stat_statements | PUBLIC relation SELECT |
| extensions.pg_stat_statements_info | PUBLIC relation SELECT |

No other relation rights, column rights, schema CREATE or accessible elevated
function permissions matched the reviewed diagnostic. Therefore the original
guard's broad non-system-relation SELECT condition caused the rejection. This
does not establish public access to financial records. The diagnostic returned
names/ACLs only; it did not inspect view contents, query history, view definitions
or extension membership. Those remaining metadata conditions are checked by the
new proposal before it can commit.

These names correspond to standard query-statistics views documented by
[Supabase](https://supabase.com/docs/guides/database/extensions/pg_stat_statements)
and [PostgreSQL](https://www.postgresql.org/docs/current/pgstatstatements.html).
PostgreSQL permits aggregate statistics access but hides other users' SQL text and
query IDs from users without superuser/pg_read_all_stats privileges. That behavior
was verified using the real extension locally; it was not tested against hosted
query-statistics contents, which were outside this diagnostic authorization.

## Smallest proposed change: create only the inspector

Exact new SQL: `supabase/sql/db04-inspection-role-v2-review.sql`. It is NOT
authorized by either earlier approval and has NOT been executed on FYP A.
It leaves both old reviewed SQL files unchanged. Its only new privilege grant is
CONNECT to database `postgres` for a new `db04_catalog_inspector`.
Reviewed working-file SHA256:
`d33a46090603bb4a39767b00d7e4d86cd950514d3211d0a83faa44a5499da437`.

The proposed transaction retains the original role restrictions/read-only and
timeout defaults, and fixes its search_path to pg_catalog. It permits the existing
PUBLIC SELECT only when all of the following are true: exact `extensions` schema,
one of the two observed names, relation kind VIEW, an actual extension dependency
on `pg_stat_statements`, and view owner equal to extension owner. Names alone or
other objects in the schema are never exempted. Non-SELECT and column modification
rights remain rejected even on those views. Financial table/column SELECT,
schema CREATE and accessible elevated functions still abort the transaction.
pg_monitor/pg_read_all_stats membership is forbidden both by the proposal and
the backend inspector gate, so statistics escalation cannot be accepted as an
inspection identity. There is no runtime role membership or Supabase Auth grant.

This is an explicit, narrow change to the old guard: a new login can retain the
already-PUBLIC statistics SELECT. The catalog inspector never queries those view
contents. This proposal does not promise a PostgreSQL login with absolutely no
monitoring metadata access; if that is required, it needs a separate assessment
of the existing PUBLIC grants. A REVOKE from just the new role cannot deny PUBLIC
rights. No PUBLIC revocation or monitoring-role redistribution is proposed.

## Effects on existing users and applications

No existing object or ACL is changed. Existing dashboard/query monitoring keeps
the same privileges. No effect on application financial permissions, queries,
RLS, authentication, API behavior or Production demo is intended or needed.
Local tests compare the monitoring relation ACLs before/after creation and prove
they remain identical. Only a new login, its CONNECT grant and its role-local
settings would be added. A newly discovered unsafe condition still aborts all of
those changes; it is not repaired automatically. An existing inspector role makes
CREATE ROLE fail instead of overwriting it.

After separate approval for this exact transaction and private password setup,
verify its actual restricted privileges, complete the ignored configuration and
run the existing catalog-only preflight. A failed/uncertain attempt stops without
retry. DB04 migrations, financial writes and hosted APIs still need later approval
based on the actual restricted report, identity compatibility and recovery plan.

## Local verification scope

Disposable PostgreSQL is configured to preload the real installed
pg_stat_statements extension. Tests install it in `extensions`, preserve its real
PUBLIC ACLs, create a proposed restricted login, and prove catalog inspection and
financial SELECT denial. They also prove other-user query text stays hidden,
stats-role escalation is rejected, and same-name fake views, financial column
grants and accessible elevated functions roll back creation. No synthetic
extension-membership rows or expected hosted results are injected.

Final affected suite: **114 passed, 0 failed, 0 skipped**, including **33 native
PostgreSQL tests**, with the installed real offline E5 runtime enabled. Raw report:
`outputs/db04-ai06/stats-inspector-v2-local.json`. Tests also preserve the original
strict proposal's unsafe-privilege rejection cases. Full project not rerun;
the previously disclosed 30 unchanged-main failures remain outstanding.
TypeScript checks, full lint, server-boundary and whitespace checks passed.

No hosted DB01--DB04 compatibility/persistence/security conclusion is inferred
from these local tests. Existing CashSource/AI06/API/five-view code and frozen
research are unchanged; the general C1/V2 cash mapping remains pending.
