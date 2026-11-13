# Production inspection result — AI06 GPT evidence migration 005

13 November 2026 · Source branch `feature/ai06-gpt-integration-celester`

**Final verdict: BLOCKED. The actual group catalog is compatible with the proposed group migration, but a verified target-specific recovery/restore option has not been established. Do not deploy 005 yet.**

This report supersedes the earlier *access-only* blocker for this explicitly authorized SQL Editor inspection. It does not authorize deployment, application activation or provider dispatch.

## Actual target and inspection method

The signed-in Chrome Supabase dashboard was controlled successfully using the browser extension after native Windows control could not verify the URL. The live URL was `https://supabase.com/dashboard/project/zmtdozblpvtjniehwjrw`; the dashboard displayed **FinGence-Production**, **main**, **PRODUCTION**, and project API hostname `zmtdozblpvtjniehwjrw.supabase.co`. No personal/unrelated project was opened.

The user explicitly requested the existing signed-in SQL Editor route. Actual database and editor session/current role were **postgres**; this was not represented as the absent restricted catalog login, and no private owner/runtime/broker connection credential was loaded or used. The editor was on the verified group project/main branch. No application row access was performed.

Three read-only SQL submissions completed through that editor:

1. Database/role/version/read-only context verification.
2. The thirty catalog SELECT/CTE sections of the prepared group catalog-v2 inspection, wrapped as labeled JSON result rows for reliable UI export. The underlying SELECTs were preserved; no application/authentication routine was invoked.
3. Supplemental catalog metadata for relevant DDL event-trigger bodies, current target-relation lock counts, aggregate transaction age/state (without query text/client identities) and PL/pgSQL availability.

Each submission used an explicit **REPEATABLE READ READ ONLY** transaction and ended **ROLLBACK**. Context results returned `transaction_read_only=on`, `isolation=repeatable read`, `search_path=pg_catalog`. Query results were copied using the SQL Editor's visible Export → Copy as JSON control and saved locally. No network/database API bypass, financial/Auth/session record SELECT, DDL, DML, permission/credential change, migration, Groq call, push, merge or deployment occurred. The SQL Editor creates/retains its own private query/history UI artifact; that is not an application-data migration.

## Database findings

| Check | Actual finding | Assessment |
| --- | --- | --- |
| PostgreSQL | **17.11**, aarch64 Linux; server_version_num 170011 | Observed target version; local native tests used 18.6 |
| DB04 baseline | All eleven expected ordinary tables, owned by postgres | Present |
| RLS | ENABLED and FORCED on **11/11** reconciliation tables | Compatible |
| Existing reconciliation keys | **23 FKs**, **17 indexes**, all captured constraints validated and indexes valid/ready/immediate | Compatible |
| Existing protections | **11 enabled immutable user triggers**, **16 RLS policies** | Compatible |
| Group identity | Five tables in `fingence_db04_group_synthetic`: organizations, users, memberships, sessions, organization_states | Present |
| Parent keys and types | Jobs, membership, job-source fingerprint and transaction-record keys match UUID/text types and immediate PK/unique requirements | Compatible |
| Runtime | `fingence_db04_group_runtime`: NOLOGIN, nonsuperuser, NOBYPASSRLS, no role/database creation or replication; no privileged ancestor memberships found | Compatible |
| Existing test login | `db04_group_test_runtime`: LOGIN with membership in group runtime, no unsafe capability flags | Observed only; no credential/login/financial behavior test performed |
| Runtime rights | SELECT/INSERT on the eleven existing reconciliation tables; no UPDATE/DELETE/TRUNCATE/REFERENCES | Compatible with append-only service |
| Broker/managed rights | No financial table/column rights on reconciliation for broker, anon, authenticated or service_role; no explicit column ACL grants | Boundary preserved |
| Existing helper execution | Runtime can execute principal(), authorized_organization(), current_grant_id(); managed roles/broker cannot | Compatible |
| Group schema exposure | Runtime has USAGE on reconciliation, no CREATE; no USAGE or direct membership SELECT on group identity schema | Deliberate boundary, not a missing grant: helpers are SECURITY DEFINER and FK checks do not require application membership SELECT |
| Defaults | No matching explicit pg_default_acl rows in the inspected scope; ordinary PostgreSQL defaults still apply | 005's new-object ACL sealing remains necessary |
| Name conflicts | No gpt_runs/gpt_items relation/index-prefix/type collisions and no gpt_complete/gpt_audit routine collisions | 005 absent; clean proposed names |
| Features | ACL/JSONPath/JSONB builtin signatures and trusted PL/pgSQL present | Required catalog capabilities available |
| Lock snapshot | No locks observed on target reconciliation relations or group memberships; zero other idle-in-transaction sessions, no other open transaction age reported | Momentary observation, not a deployment-window guarantee |

Expected existing tables: audit, cases, decisions, documents, job_sources, jobs, proposal_verifications, proposals, rankings, reviews and transactions. The checked keys are:

- jobs `(organization_id, processing_id)` PK.
- group memberships `(user_id, organization_id)` PK.
- job_sources `(organization_id, processing_id, sha256, kind)` UNIQUE.
- transactions `(organization_id, processing_id, kind, record_id)` PK.

All required key columns are NOT NULL with compatible UUID/text types. No prerequisite reinstall, identity alias or grant repair is needed for this observed catalog. Existing migrations 001–004 are reference contracts only and must never be replayed on this target.

## Authentication, RLS and audit dependencies

Actual principal() returns UUID user/organization from the group synthetic sessions/users/memberships/organization_states. Its inspected body requires the opaque server token hash, an unrevoked unexpired lease, active organization and Finance membership, matching membership version, unsuspended user, contract `group-synthetic-admission/1`, and issuer `urn:fingence:db04:group-synthetic:1`. It locks the authority rows FOR SHARE. This is the existing synthetic lane, not approval to map real clients or replace Jason's authentication.

principal(), authorized_organization() and current_grant_id() are SECURITY DEFINER, owned by postgres, with fixed pg_catalog search paths and restricted EXECUTE ACLs. immutable() is SECURITY INVOKER with pg_catalog search path and raises SQLSTATE 23514. Their signatures match the new migration. No routine was called to obtain a tenant or session grant.

Existing audit has generated bigint identity, actor/organization/job/action, clock_timestamp() and **session_grant_id UUID NOT NULL DEFAULT fingence_reconciliation.current_grant_id()**. The validated FK binds `(session_grant_id, actor_id, organization_id)` to group sessions `(id, user_id, organization_id)`. The action CHECK accepts PERSISTED and READ (plus existing REUSED/REVIEWED). Runtime already has the helper EXECUTE, audit INSERT and audit sequence USAGE required by the existing service contract. No extra audit column lacks an inspected supporting default for the proposed four-column insert.

Existing ranking checks still allow only fuzzy/E5 versions. proposal_verifications retains `db04-independent-proposals/1`, UNRESOLVED-only outcome and array checks. Migration 005 does not widen either table's version/status rules or overwrite deterministic decisions.

## Event triggers and teammate impact

Seven existing DDL event triggers were inventoried. Relevant observed bodies:

- `public.rls_auto_enable()` processes CREATE TABLE-related events only for the **public** schema. It skips reconciliation; 005 explicitly ENABLEs/FORCEs RLS on its own new tables.
- `extensions.pgrst_ddl_watch()` emits `NOTIFY pgrst, 'reload schema'` for applicable DDL. This expected platform schema-cache notification is an operational effect of future migration, not a financial-row write. Extension-create/drop-only event triggers are not targeted by 005.

Chia's public ingestion/financial constraint triggers and Auth relation definitions were inventoried as metadata. No records, users, sessions, source content, balances, actual passwords or tokens were read. Existing functions/tables/policies were not changed. Because no financial rows were scanned, this is not a content-hash comparison or behavioral certification of unseen records; preservation is established by read-only execution and additive source scope.

005 creates only new GPT evidence objects. It references existing jobs, group memberships, job_sources and transactions, adding the expected FK-internal RI trigger/dependency entries on parent tables. Existing logical columns, grants, policies, ingestion/authentication implementations, deterministic decisions and E5 evidence are not modified. Later explicit GPT persistence will append protected existing audit rows; no such writes occurred during this inspection.

## Exact migration and proposed new objects

**Only proposed application file:**

`supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql`

**SHA256:** `e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e`

The original local 005 remains unchanged and is **not** the deployment candidate. The group file substitutes only the group membership FK and group runtime grant. Apply neither file in this task; never apply both.

New explicit objects: gpt_runs and gpt_items (tenant/job/source/model/prompt/policy/fingerprint/ordered claim, abstention and verification evidence); two zero-argument SECURITY INVOKER trigger functions gpt_complete()/gpt_audit(); five user triggers; three policies; eight FKs; two PKs, one unique constraint and their three backing indexes; 38 CHECK expressions and declared NOT NULL constraints. PostgreSQL also creates row/array/TOAST/dependency/RI-internal objects as applicable.

Both new tables have ENABLE/FORCE RLS, immutable evidence, exact group-bound parent FKs and UNRESOLVED-only outcomes. The group runtime receives SELECT/INSERT only on the two new tables. PUBLIC/non-owner direct defaults are sealed only on those new tables/functions. No existing schema-wide ACL/default/role membership change is proposed. The single transaction and audit trigger preserve atomicity; completion triggers enforce exact item counts/ordinals at commit.

## Recovery finding — critical deployment blocker

Actual group dashboard observations:

- Project Overview: **LAST BACKUP — No backups**.
- Scheduled Backups page: **Free Plan does not include project backups**, with an upgrade offer; no available backup/restore entry was shown.
- Point in Time page: PITR presented as a **Pro Plan add-on**, with an upgrade offer rather than an enabled recovery window.

No external backup inventory, target-specific backup hash/reference, isolated successful restore or accepted recovery RPO/RTO was supplied/verified. This does **not** prove that no external copy exists; it means a verified recovery option is presently absent from the inspection evidence. Historical disposable local recovery tests are not a backup of this live group database.

**Required resolution before deployment:** authorized group owner supplies and verifies a recoverable target-specific backup/recovery path, with scope/time/reference, permissions/schema/role coverage, restore evidence, incident owner and agreed RPO/RTO. Backup exports, restores, paid plan changes and data movement are separate actions; none was attempted or enabled. No recovery waiver is inferred from approval to inspect.

## Lock risks and exact conditional execution order

The instantaneous absence of locks/open transactions is not permission to ignore live traffic. New FKs acquire locks on referenced jobs, memberships, job_sources and transactions, and DDL/index/constraint creation takes object/schema/catalog locks. Contention can block active reconciliation/auth work or time out; do not disable constraints/RLS to bypass it. Empty new tables do not eliminate parent lock acquisition.

Execution order for the **next** authorized deployment task:

1. **Resolve recovery blocker first.** Attach target-specific verified restore/recovery evidence. No deployment should proceed solely because the catalog checks pass.
2. Reconfirm the same exact group project/main Production target and candidate SHA256; check for concurrent drift/new collisions and incompatible traffic. Keep unrelated app/provider changes out of this schema operation.
3. Obtain explicit approval for this single group migration, executor identity, bounded lock/statement timeouts, maintenance window and rollback handling. The frozen file has its own BEGIN/COMMIT and does not set timeouts; the next prompt must establish the approved executor timeout mechanism/exact batch, not silently edit the file or rely on a different pooled session's settings.
4. Execute **only** the checksum-pinned group-target file as its one transaction. No 001–004, test bootstrap, original local 005, synthetic seed, role creation, credential activation or financial write is part of that application. Stop/rollback on any error; no blind retry after an uncertain COMMIT.
5. After acknowledged COMMIT, run the prepared read-only postdeployment catalog file listed below. Preserve expected logical existing definitions/ACLs; allow only new GPT and expected FK-internal/platform-notification effects. If new evidence exists later, retain it during an application rollback rather than deleting immutable history.
6. Stop after schema verification. Current GPT app methods retain local-only guards; hosted application/admission activation and real provider dispatch require their own explicit scope. A SQL-compatible synthetic lane is not a real-user authentication rollout.

No destructive down/CASCADE script or full-project restore instruction is authorized. Before-commit failure rolls back the new DDL. After-commit issues require disabling optional new writers/roll-forward investigation with preserved evidence; any removal or whole-project restore needs coordinated separate approval because teammates' later work could be affected.

## Prepared postdeployment verification SQL

`supabase/tests/db04-005-group-postdeployment-catalog.sql` is **prepared, not executed**. It reads only catalogs, runs READ ONLY, and ends ROLLBACK. It checks:

- Expected totals from the observed baseline: **13 tables, 31 FKs, 20 indexes, 16 noninternal user triggers and 19 policies** if no unrelated drift occurs.
- Both new table shapes, ENABLE/FORCE RLS, exact eight FK targets/group membership binding, valid immediate unique indexes, UNRESOLVED/reason constraints, five explicit trigger definitions and deferred completion flags.
- Three policies and two new invoker functions with pg_catalog paths, runtime-only SELECT/INSERT/effective column rights and sealed PUBLIC/managed/broker rights.
- Existing audit columns/default and principal/tenant/grant/immutable routine definitions remain unchanged.

Metadata counts alone are not sufficient: compare the definitions, target bindings, ACLs and baseline captured in this session. No financial-row fingerprint/count or Production test insert is included.

## Evidence and limits

A sanitized machine summary contains 20 derived catalog compatibility checks; all passed. These are catalog/source assessments, not twenty application tests. Original current results are retained privately under `.local/reviews/sql-editor-inspection-20261113/` (catalog JSON, section map, actual executed SQL, supplemental result JSON, recovery-page text/screenshots). Raw routine/security metadata is excluded from the shareable ZIP; sanitized findings, executed SQL, screenshots and hashes are included. The query URL identifies the same group SQL Editor snippet, not another project.

Previous focused local evidence remains **34 passed / 0 failed / 0 skipped**, including **15 group-compatible native tests**; broader historical baseline remains **157 passed / 0 failed / 1 skipped web journey**, not added to 34. No local test was repeated during this inspection. Actual target is 17.11 while native proof used 18.6; catalog feature/signature/key checks passed on 17.11, but no DDL or runtime transaction behavior was tested on the hosted target. Treat that version-specific execution/behavior gap as an explicit residual risk for deployment approval.

Migration files and Production code are unchanged. New deliverables are this single readiness report and the unexecuted postdeployment catalog SQL, plus ignored sanitized evidence/review package.

**Final decision: BLOCKED on verified recovery readiness. Catalog compatibility: PASS. Actual inspection: COMPLETED. Migration 005: NOT EXECUTED.**
