# Personal FYP A: restricted hosted inspection completed

2 November 2026. Started at `72589d12797a887bd152b3b7ea3ca2dae51271ab`
on `feature/db04-ai06-supabase-celester`. Target is the owner's personal FYP A,
`fhipzomczevbpybezzxu`, database `postgres`. Team Production was not accessed.

## Actual authorized execution

The exact approved v2 SQL checksum matched both the owner's approval and reviewed
file: `d33a46090603bb4a39767b00d7e4d86cd950514d3211d0a83faa44a5499da437`.
The private owner connection's project/reference/direct host, database, role and
TLS certificate validation were checked, and actual database/role/SSL identity
was verified. The v2 transaction was submitted once and COMMIT acknowledged.
Its extension-view membership/ownership and security guards passed. Existing
PUBLIC permissions and application objects were not changed.

The new role's flags were checked before password setup. The owner then entered
the independent password in psql's two masked `\password` prompts in a private
local terminal and re-entered it in a masked prompt for private configuration.
No secret was echoed, printed to tool output, committed or sent in chat. psql
handled password encryption; no custom password SQL or hashing implementation
was introduced. The resulting private connection authenticated successfully.

`.local/db04-inspection.env` is configured and Git-ignored with protected Windows
ACL. The CA certificate and full catalog output are also private/ignored. No
credentials or certificate files are included in evidence or review ZIPs.
The owner connection was closed after provisioning. All subsequent catalog checks
used only `db04_catalog_inspector` with verified TLS.

Actual role: no superuser, BYPASSRLS, CREATEDB, CREATEROLE, replication or inherited
role privileges; connection limit 1; no pg_monitor/pg_read_all_stats membership.
Role defaults: read-only transactions, 10s statement timeout, 3s lock timeout and
search_path pg_catalog. The existing preflight's identity/privilege gate passed.
All inspected application-table SELECT/write privilege flags were false; column
access was checked by the gate. No financial SELECT was attempted. Statistics-view
contents were never queried on hosted FYP A. This does not claim row-level Finance
authorization or RLS enforcement tests: there is no hosted DB04 runtime yet.

## Verified hosted metadata

| Area | Actual finding |
| --- | --- |
| Server | PostgreSQL 17.11; restricted role/read-only transaction/TLS verified |
| Foundation | financial_records, ingestion_batches, validation_issues, persistence_attempts; 63 columns, 52 constraints, 13 indexes |
| Financial types | debit, credit, source_amount, derived_ledger_net and balance are unconstrained numeric, not floating point |
| Grouping | persistence_attempts and ingestion_batches.persistence_attempt_id exist |
| DB02 integrity | Five source-file/warning consistency triggers are enabled; serialization fence trigger and its named function are absent |
| Existing validation | financial_records_source_file_safe is CHECK NOT VALID; existing-row compliance is unknown |
| Foundation RLS | Enabled on all four tables; not FORCE RLS; no policies returned for these four tables |
| Existing ACLs | Foundation ownership is postgres; direct owner/service_role privileges exist; inspector has no data privileges |
| Identity | fingence_m2 organizations/users/memberships/sessions and fingence_m3 organization_states all absent |
| DB04 | All eleven required tables, runtime role and three required security functions absent |
| DB03 | Recovery/backup correctness cannot be established by these catalogs |

The DB02 function-name check found no conflicting
public.serialize_warning_issue_mutation overload. Supabase anon/authenticated/
service_role roles exist. These were metadata-only checks. RLS and ACL presence
does not prove that an application with owner/service credentials is tenant-safe.
No hosted financial row, session/audit content, processing job or synthetic
document was read or written. Numeric types prove storage capability, not a
successful hosted monetary round trip. Object presence is not a migration ledger.

Sanitized evidence: `db04-hosted-inspection-results.json`. Full metadata remains
private, with its SHA256 in that summary. The readiness assessor now also reports
missing/disabled DB02 fences and unvalidated foundation constraints, rather than
letting a DB04-only check hide those deployment blockers.

## Exact next plan, not authorized or executed

1. **Recovery gate:** obtain a verified personal-project backup and restore plan
   from the database owner before any application migration. No DB03 DDL is
   invented; catalog existence does not replace restore evidence.
2. **Existing NOT VALID check:** have the owner review the outstanding
   financial_records_source_file_safe validation. This task did not inspect rows.
   No automatic VALIDATE, data scan, rewrite, cleanup or constraint drop is
   proposed for execution now. A separate data-validation authorization/plan is
   required; do not claim the historic records are compliant.
3. **Smallest identified additive DB02 candidate:** the exact existing
   `supabase/sql/db02-001-warning-mutation-fence.sql`, SHA256
   `8a991309f2f4d4192ac9a782cc369348c93c0f098ce31c370424940897a33089`.
   Required existing tables/columns, old trigger ordering, roles and absence of
   conflicting function/trigger names are established by the restricted report.
   It creates only the new trigger function and BEFORE trigger, restricts EXECUTE
   on that new function and adds its comment. It does not rewrite financial values
   or change existing PUBLIC monitoring grants/RLS. Installation performs no
   financial UPDATE; future warning mutations deliberately perform identical-value
   parent updates to serialize with existing deferred checks. Those future writes
   can introduce lock waits/deadlocks and must fail safely without automatic retry.
   They also recheck constraints on affected rows: a legacy unsafe source_file
   could make a future fence update fail even though installation succeeds. That
   is why the outstanding NOT VALID review cannot be skipped or called harmless.
   Run as the reviewed owner during an approved maintenance window, after gates
   1--2 and explicit approval. Its own BEGIN/COMMIT is atomic; on failure ROLLBACK
   and stop. Do not automatically drop installed objects or weaken constraints.
4. **Hosted identity prerequisite:** obtain the approved subject-to-organization/
   Finance membership/session revocation contract. Local M2/M3 are absent; do not
   replay v2-m2-local.sql or v2-m3-local.sql or invent Supabase Auth compatibility.
   A concrete hosted identity migration cannot be authored honestly without that
   trust boundary. No authentication change is requested by this plan.
5. **DB04 only after approved identity/recovery:** intended dependency order is
   db04-001-reconciliation.sql, db04-002-reconciliation-security.sql,
   db04-003-ranking-evidence.sql, db04-004-proposal-verification.sql. Exact hashes
   are in `db04-hosted-next-migration-manifest.json`; these remain reviewed local
   references, not a currently executable hosted batch. They add the separate
   schema/tables, forced RLS, restricted runtime grants, safe security functions,
   append-only evidence and tenant/source FKs. Missing M2/M3 FKs and principal
   dependencies block 001/002 today. Do not run 003/004 against absent parents.
6. **Separate future verification:** after approved migrations and identity setup,
   verify synthetic BANK/LEDGER commit/read/reconnect, exact amounts/lineage,
   independent proposals, duplicate/concurrency/rollback and restricted runtime
   RLS/tenant/session controls. Only then enable a reviewed development API path
   and verify all five views. Existing endpoints remain local-only.

No approval is requested for a blind DB04 installation. The next independently
reviewable SQL is the DB02 candidate above, conditional on recovery and validation
review. The identity and historical-data gates are explicit remaining dependencies.
Existing C1/V2 still needs trusted cash classification, VALUE_DATE provenance and
organization/processing binding; accepted generic records are not silently cast.
Frozen AI research, financial algorithms, APIs and Production demo are unchanged.

## Executed local verification

Final affected run: **146 passed, 0 failed, 0 skipped**, including **33 native
PostgreSQL tests** and the existing DB02 PGlite integrity suite. The real installed
offline E5 runtime was enabled. Command:
`DB04_E5_SMOKE=1 pnpm exec vitest run tests/reconciliation-persistence tests/persistence/db02.integrity.test.ts --maxWorkers=1`.
Raw report: `outputs/db04-ai06/hosted-role-catalog-local-final.json`.
The initial run had 145 passed/1 failed/0 skipped because the old native assertion
expected only three readiness blockers; the existing NOT VALID constraint is now
correctly the fourth blocker even on the local foundation. That expectation was
updated and the complete affected run repeated. Earlier evidence was preserved.
The full project was not rerun; the previously disclosed 30 unchanged-main failures
remain outstanding. Hosted evidence is role/password/authenticated metadata only,
not financial persistence or runtime-RLS/security test evidence.
`pnpm typecheck`, full `pnpm lint`, `pnpm check:server-boundary` and whitespace
checks passed. All eight changed files were reviewed as DB04 readiness,
relevant tests and sanitized integration evidence; private credentials/certificates
and full catalog output are excluded from Git and the temporary review ZIP.
