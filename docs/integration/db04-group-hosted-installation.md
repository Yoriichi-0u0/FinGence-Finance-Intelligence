# Group hosted installation — committed; AI06 awaits private credentials

3 November 2026. Target **FinGence-Production / zmtdozblpvtjniehwjrw / postgres**,
PostgreSQL **17.11**, accessed through the authorized Chrome Supabase SQL Editor as
`postgres`. This is actual hosted installation evidence, separate from local tests.

## Approval and acknowledged transactions

The user explicitly stated that the group owner approved proceeding with the existing
package at `9fba183831f7a93325f4196c53d25495a7155342`, including the three reviewed
artifacts, restricted synthetic identities, private password provisioning, registered
BANK/LEDGER scope and documented recovery limitations. The approval record identifies
that user attestation as its source; no independent owner signature/document is claimed.
The private operator record is ignored by Git. All three approved hashes were reverified.

| Transaction | SHA256 | Actual result |
| --- | --- | --- |
| install-review.sql | 21ea11b4eaf63897e9379ee0cb6cefb3cc973662cdc65c733a3eb84ec60b6df9 | Editor acknowledged success; independently verified in the catalog |
| synthetic-seed-review.sql | 77ff0daa71cb64513d22b40244a6017081a821739905a5e466720d4148741e46 | Editor acknowledged success; synthetic identity counts and disabled roles verified |
| activate-logins-review.sql | f323717dbec88e6ef2ba2cc488a4ca9bac623919648c069d892fdc29ba56661e | **Not executed**; private password provisioning is incomplete |

Both executed files ended with their reviewed COMMIT. Neither was resubmitted after
its acknowledgement. Do not rerun them to resume the remaining stages.

Supabase showed an RLS detection warning. Initial automated action review rejected
the plain-run confirmation. After inspecting the exact SQL and the
[official editor implementation](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/SQLEditor/SQLEditorLayout.tsx),
which runs the original SQL on ordinary confirmation and rewrites it on the RLS-addition
action, re-review permitted execution of the original approved bytes. No RLS-disable
statement or unreviewed appended SQL was executed. Actual flags were checked afterwards.

## Independently observed hosted catalog

| Schema | Tables | RLS enabled | Forced RLS |
| --- | ---: | ---: | ---: |
| public | 4 | 4 | 0 |
| fingence_reconciliation | 11 | 11 | 11 |
| fingence_db04_group_synthetic | 5 | 5 | 0 |

The reconciliation catalog has **23 foreign keys**, **17 indexes** and **11 immutable
triggers**. There are zero unvalidated constraints across the installed schemas, zero
wrong numeric types in the checked financial columns, and zero security-definer functions
without the required safe search path. anon/authenticated/service_role have no financial
table/column grants in the installed schemas.

The approved synthetic seed has two organizations, two users, two memberships and two
organization-state rows. Both test roles remain NOLOGIN and lack superuser, BYPASSRLS,
role/database creation and replication flags. The broker has no reconciliation financial
table privileges; the financial runtime has no public foundation privileges.

These are **23 passing installation/catalog checks**, not 23 authenticated application
workflow tests. The exact executed verification SELECTs and machine-readable observations
are in `db04-group-hosted-catalog-queries.sql` and `db04-group-hosted-installation.json`.
No real financial transaction contents, real authentication rows or credentials were read.

## Exact remaining blocker

The user reported **“Owner database password unavailable or rejected”** during the
approved private password procedure. There is no completed provisioning marker or
restricted runtime configuration. The procedure uses masked psql prompts, pinned group
host and verify-full TLS; it does not load the rejected owner URI password. Passwords
and password verifiers must not be placed in SQL Editor query history as a substitute.

No successful password provisioning, login activation, restricted authentication or
AI06 financial processing is claimed. Do not assume that the open browser owner session
provides a usable private PostgreSQL password. A waiting private terminal can be closed
by the user if they cannot complete it; do not enter or share credentials in chat.

Resume only after a group operator can complete the approved masked password provisioning
for the two existing test roles and save the private runtime/broker configuration. No new
schema approval is needed for the already-approved unchanged sequence. Then inspect any
partial provisioning outcome, execute the reviewed activation once, verify both restricted
TLS connections independently, and run the existing approved hosted synthetic CLI. Stop
on authentication/security errors or uncertain commits; never reinstall or broaden grants.

## Module status and verification limits

- **DB01:** Four-table foundation installed. No existing public tables/records were
  overwritten; the preinstallation catalog had no public tables.
- **DB02:** Persistence/integrity schema, indexes and consistency triggers installed.
  Public financial runtime access remains closed pending the approved team ownership
  interface. No hosted public financial writer or real ingestion is claimed operational.
- **DB03:** Group PostgreSQL 17.11 identity verified. No group backup export or restore
  was performed. Existing local PostgreSQL 18.6 recovery evidence remains valid for its
  synthetic scope and does not certify PostgreSQL 17.11/provider recovery.
- **DB04:** Eleven reconciliation tables installed with enabled/forced RLS and immutable
  evidence protection; runtime enforcement tests await restricted login authentication.
- **AI06:** **Not executed on the group database.** No BANK/LEDGER financial records,
  matching proposals, E5 rankings or independent verification evidence have been written
  by the hosted runner. Duplicate/reconnection/organization-isolation and five-model
  hosted application tests remain pending. AI01–AI05 code/research evidence is unchanged.

Hosted application workflow checks executed: **0**. Historical local results remain
**641 passed / 0 failed / 1 skipped**, including 101 DB04/group tests and 37 native tests;
they were not rerun for this evidence-only commit or relabelled as hosted passes.

Approved new objects and synthetic identity rows were created in group Production.
Supabase Auth, Jason's M2/M3 module, frontend, Vercel, main, teammate branches and existing
financial data were not changed. Draft PR #59 remains separate and unmerged.
