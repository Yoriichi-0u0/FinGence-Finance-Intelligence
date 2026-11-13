# Group catalog access and DB04 005 compatibility resolution — review only

12 November 2026 · Source branch `feature/ai06-gpt-integration-celester`

**Status: proposed procedures only. No Supabase connection, role creation, SQL execution, credential change or deployment.** Target is user-declared Group `FinGence-Production`, database branch `main`, schema `fingence_reconciliation`. Historical source identifies project `zmtdozblpvtjniehwjrw`, database `postgres`; current branch/identity/catalog remain unverified.

## New proposed files

| File | Purpose / authority boundary |
| --- | --- |
| `supabase/sql/db04-group-access-review/01-provision-catalog-inspector-review.sql` | Authorized group owner only, after explicit provisioning approval. Creates a fresh disabled inspector with CONNECT, no memberships or private grants, and a fail-closed effective-privilege check. NOT EXECUTED. |
| `supabase/tests/db04-group-catalog-access-gate-review.sql` | New restricted login's identity/privilege/TLS metadata gate before broader inspection. READ ONLY; NOT EXECUTED. |
| `supabase/tests/db04-005-group-catalog-review-v2.sql` | New group-specific catalog-only inspection revision; covers group synthetic identity namespace/runtime and avoids private-name resolution requiring schema USAGE. NOT EXECUTED. |
| `supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql` | Separate group-target alternative to original 005. Adds the same new GPT objects, with only membership target/runtime role substitutions. NOT EXECUTED; mutually exclusive with original 005. |

Original migrations 001–005, previously reviewed inspection SQL, teammates' objects/policies, Production TypeScript and credentials remain unchanged. None of the new files is added to an install/deployment manifest. Role and application migration files are separate approvals, not a batch to run together.

## 1. Owner-only inspector provisioning procedure

The blocked report found group owner/runtime/broker configurations and a separate personal FYP A inspector, but no group catalog-only inspector. Do not use any of those identities as an inspection fallback. An authorized group owner may provision the new role only after the owner approves this exact file, project/main branch, lifetime and private credential-handling procedure. The assistant does not receive or use the owner's credentials.

1. Owner attests the immutable project ID and actual main database-branch ID/connection endpoint using the group's approved control-plane process. Confirm `FinGence-Production`, historical candidate project `zmtdozblpvtjniehwjrw` and database `postgres`; reconcile any discrepancy before SQL. A display name/current_database()/Git branch cannot prove this binding.
2. Review existing PUBLIC database/schema/table/column/sequence/routine privileges and the exact provisioning guard. Existing role-name collision is a stop, not permission to adopt/reset an account. Owner must be permitted to create this restricted role and grant CONNECT without extending existing grants.
3. Only after separate approval, owner runs `01-provision-catalog-inspector-review.sql` with stop-on-error and rollback on failure. It creates `db04_group_catalog_inspector` as **NOLOGIN**, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOINHERIT, connection limit 1. The only explicit object grant is CONNECT on postgres. Role defaults set read-only transactions, pg_catalog search path and bounded statement/lock/idle-transaction timeouts.
4. The guard rejects any role membership, object ownership checked by the predicate, database CREATE/TEMPORARY, user-schema CREATE, effective user-table/view/foreign-table or column rights, sequence rights, or callable noncatalog application/extension routines (trigger-return routines are not directly callable and excluded). It evaluates effective rights, including PUBLIC, without selecting application rows or invoking application routines. No monitoring-view exception, private-schema USAGE, pg_monitor/pg_read_all_stats/pg_read_all_data membership or SECURITY DEFINER gateway is added.
5. If the guard fails, rollback the new role/CONNECT/settings transaction. Do not change shared PUBLIC grants, other roles, routines, teammates' schemas or defaults. This may legitimately block provisioning on the current platform configuration. In particular PUBLIC TEMPORARY, PUBLIC schema CREATE, a readable user view or executable application/extension routine cannot be canceled by REVOKE from only this role. Resolve that as a separately scoped security decision or stop; no privileged fallback is offered.
6. The role remains disabled and has no password in the SQL. After separate owner approval for private credential provisioning and login activation, owner rechecks the same effective-privilege predicate and current target. An already authorized secure psql session may use the masked interactive `\password db04_group_catalog_inspector` command; do not paste secrets/verifiers into SQL Editor history, chat, environment dumps, logs or this repo. The reviewed activation statement is `ALTER ROLE db04_group_catalog_inspector LOGIN;` and is an owner-only future operation, not executed here. Set the agreed credential expiry through the owner's private procedure if required; no timestamp/password is fabricated in these artifacts.
7. Owner supplies only the restricted inspector's connection and group trust configuration through the existing private secret channel/ignored local configuration. Do not reuse the personal inspector's target declaration/credential or owner/runtime/broker secret. Inspectors are not granted application access to compensate for a denied query.

Read-only defaults and NOINHERIT are defense in depth: the login can change its own session settings, PUBLIC applies independently, and NOINHERIT alone does not forbid SET ROLE. The mandatory absence of *all* outgoing role memberships and effective noncatalog capabilities is the real privilege boundary. The guards conservatively reject callable user routines; safe-looking invoker routines are not automatically allowlisted. This can fail closed on extension/public helpers and is not evidence the helper itself is malicious.

Provisioning checks are scoped to the current database and shared role/ownership catalogs. They do not certify privileges inside other databases. The group owner must confirm the cluster/database access boundary; the client must be pinned to the approved postgres database and never enumerate/connect to another database to work around a failure.

No existing grants are revoked by this owner file. Owner role creation is a planned access operation, explicitly separate from the prohibition on using an owner account to perform the catalog inspection. A deployment/owner session must never masquerade as the inspector via SET ROLE.

## 2. Connection and inspection verification

Before any connection: owner-approved control-plane attestation must bind immutable project ID, main branch ID, expected database, dedicated inspector username and exact host/port. Historical source is evidence of a candidate project, not fresh attestation. The Supabase main branch is not the source Git feature branch.

Use certificate/hostname verification against the group's approved CA chain; reject disabled verification, plaintext connections, redirect/fallback targets and personal FYP A. Prefer an independently approved direct project endpoint. If the owner approves a session pooler, pin its endpoint, session-mode port and exact project-qualified inspector username; regional pooler hostname alone does not identify the project. Do not use transaction pooling for the session-bound inspection procedure or assume a shared TLS hostname attests a project. No connection URL or credentials are included here.

On the exact restricted TLS connection, run only the separately approved `db04-group-catalog-access-gate-review.sql` first. It reads PostgreSQL catalog metadata and the current backend's pg_stat_ssl row. Require:

- Exactly one identity row: current_database=postgres, current_user=session_user=db04_group_catalog_inspector, login enabled, connection cap 1, NOINHERIT, read-only REPEATABLE READ and pg_catalog search path.
- Exactly one privilege row and every capability boolean true; no memberships, unsafe role flags, ownership, effective user row/column/sequence rights, database/schema creation or reachable application routines. Zero rows, null/false values, errors or denied metadata are stops.
- Expected server version recorded as an observation; actual TLS evidence accepted. The pg_stat_ssl result describes the backend hop; client hostname/certificate verification is independently required, especially for a pooler. No extra statistics memberships are granted to obtain it.

The gate ends ROLLBACK. Only after its result is accepted, run the approved group catalog v2 on the same pinned login/transport with no role switch or privilege changes. Recheck gates after reconnects or any privilege/target drift; the role's owner must not change shared rights during the inspection window. On any permission/identity/TLS/timeout error, rollback/close and stop. Do not run broader SQL first and retroactively accept its later privilege results.

The new catalog revision keeps the earlier metadata-only scope and adds the actual historical group identity layout. It resolves private relation/routine names using pg_catalog OID joins, not private schema USAGE or execution of principal/auth routines. It reads no financial/user/session rows, performs no counts on business relations, invokes no tenant/auth/grant routines and creates no temporary objects. Catalog counts are permitted; they count metadata, not financial data. Allowlisted routine definitions and security metadata are sensitive review evidence and must remain protected/sanitized.

The script captures version; expected eleven DB04 tables; types/defaults/keys/constraints/index validity; inbound/outbound FKs; user/internal triggers; forced RLS and policies; group runtime/broker capabilities; memberships; direct/effective/column/default ACLs; authentication helper signatures/definitions; audit column/default/sequence dependencies; event triggers; and new-object collisions. Metadata dependency graphs can omit dynamic/PL/pgSQL references, so responsible-owner source review remains necessary. No live observation is claimed today.

## 3. Exact historical group dependency differences

Source: local Git object `943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9`, `supabase/sql/db04-group-review/install-review.sql` and its installation report. Observed in source only; live confirmation is mandatory.

| Dependency | Original AI06 005 / accompanying legacy path | Historical group contract | Resolution |
| --- | --- | --- | --- |
| Run actor membership FK | `fingence_m2.memberships(user_id,organization_id)` | `fingence_db04_group_synthetic.memberships(user_id,organization_id)` | New group alternative substitutes only this FK target. Never create M2 aliases/views/copies to pretend the identity universes are equivalent. |
| Financial runtime grant | `fingence_reconciliation_runtime` | `fingence_db04_group_runtime` (historical test login `db04_group_test_runtime`) | New group alternative grants the existing group role SELECT/INSERT only on the two new GPT tables. No membership or existing grant changes. |
| Broker role/lane | Legacy/personal broker composition | `fingence_db04_group_broker` (historical test login `db04_group_test_broker`) | Inspector is a member of neither lane. No new GPT grant to broker. Application composition remains a separate task. |
| Identity schema | Original local tests use M2/M3 tables; personal hosted source has FYP-A bindings | Group synthetic organizations/users/memberships/sessions/organization_states all live in `fingence_db04_group_synthetic` | Reuse existing group authority functions; do not create or modify authentication relations. |
| Synthetic users | Personal hosted source pins its FYP-A issuer | Group user issuer is exactly `urn:fingence:db04:group-synthetic:1`; users retain `(issuer,subject)` uniqueness and suspension | This is an isolated synthetic identity contract, not Jason's real-user authentication approval. No issuer rewrite or real-user mapping. |
| Sessions | Personal adapter uses `hosted-finance-admission/1`; local sessions have a different shape | Group sessions have id, token_hash, user_id, organization_id, upstream_session_id, expires_at, revoked, membership_version, contract_version=`group-synthetic-admission/1`; unique `(id,user_id,organization_id)` | Inspect metadata only; no session/token reads. Do not copy old session records or cast contracts. |
| Existing `principal()` | Same public signature; legacy implementation differs | UUID user/org result; joins group sessions/users/memberships/states; opaque server token hash; valid lease, active Finance membership/version, unsuspended user, group issuer/contract; locks identity rows FOR SHARE | Preserve the existing function unchanged. Jason/owner must confirm approved authority/lifecycle; signatures alone are insufficient. |
| Existing tenant/immutable helpers | Zero-arg authorized_organization()/immutable() | Existing group helpers retain the same signatures and protected semantics | Reuse unchanged, with forced RLS and existing immutable trigger behavior. No wrappers/replacements. |
| Existing audit shape | Base 001 supplies actor/org/job/action and generated id/time | Group audit additionally has `session_grant_id uuid NOT NULL DEFAULT fingence_reconciliation.current_grant_id()` and FK `(session_grant_id,actor_id,organization_id)` to group sessions `(id,user_id,organization_id)` | New gpt_audit() keeps the existing four-column PERSISTED insert; default must resolve current group grant and satisfy FK. Do not add/drop columns or weaken defaults/FKs. |
| Existing grant helper | Personal grant relation/contract differs | current_grant_id() returns UUID from group sessions joined to principal(); group runtime already has execution rights | Verify signature, search path, owner, ACL, same-token binding and runtime/default permissions; do not invoke it during inspection or grant new rights to it. |
| Version | Local native evidence: PostgreSQL 18.6 | Dated group report: PostgreSQL 17.11 | Both are historical scope, not today's version. Test proposed variant in an approved isolated environment matching actual target before considering deployment. |

The original 005 directly depends on only the membership relation, existing runtime role and existing helper/audit/key contracts above; it does not itself define the legacy personal issuer. The personal FYP-A-specific application admission code is an additional application-level incompatibility, not a reason to rewrite group authentication. The committed group integration candidate uses injected admission rather than personal fallback. This task changes no TypeScript and does not authorize activating GPT in Production.

## 4. Smallest additive compatibility solution

The proposed new group-target SQL copies frozen 005 and makes exactly two body substitutions:

```text
fingence_m2.memberships -> fingence_db04_group_synthetic.memberships
fingence_reconciliation_runtime -> fingence_db04_group_runtime
```

A static reverse-substitution check verifies the rest of the migration body is identical. The original 005 stays at SHA256 `7813c97657cb947e950d23d88d7e2666ed9a57dc8b72daa73c8bc2a603a9ff92`. The group file is an **alternative to original 005**, not an upgrade after it; never apply both, drop/recreate conflicting GPT tables, or reinstall 001–004. Any collision/partial prior install stops work for a new review.

The candidate still adds only two GPT tables (run headers and ordered items), two SECURITY INVOKER trigger functions, five explicit triggers, three policies, eight tenant/job-bound FKs and three backing unique indexes, with UNRESOLVED-only outcomes, append-only evidence, exact content idempotency from server code, atomic existing-audit inserts and new-object ACL sealing. Referenced parent keys must match UUID/text types and valid nondeferrable uniqueness. PostgreSQL also creates row/array types, TOAST/dependency/RI-internal objects; expected internal FK entries on existing parents are not changes to teammates' financial values or logical policies.

Only the existing group runtime gains SELECT/INSERT on the **new** tables. PUBLIC and non-owner default grants are removed only from the new GPT tables/functions. No schema-wide existing-object revoke, default-ACL edit, new financial copy, auth alias, broker/inspector financial grant, existing policy replacement, E5/decision update, real-user mapping, or grant to existing helper/audit tables is proposed.

This solution is conditional on live group contracts matching the historical source and on the synthetic lane being approved. If the current group uses another authority/membership contract, do not substitute namespaces based on names alone. Stop for owner/Jason interface resolution. It is not safe to make 005 apply by fabricating membership data or modifying Chia's/Jason's work.

## 5. Approvals and execution order

Each stage is a proposal; **none has been executed here**.

1. **Owner/access approval:** confirm exact group project/main-branch binding, authorized provisioning operator, intended inspector, least-privilege file hash and private credential/lifetime procedure. Access provisioning does not approve GPT DDL. No owner connection is provided to the inspecting agent.
2. **Owner-only disabled role creation:** run reviewed provisioning SQL only after approval; commit only if its guard passes. Any PUBLIC/effective-right obstacle stops this stage. No shared permission repair is authorized.
3. **Owner-only private credential/activation:** separate explicit authorization for masked password setup and LOGIN activation, with privilege recheck. Do not rerun CREATE ROLE. Provide only the restricted configuration privately; no secrets in review artifacts.
4. **Restricted inspection approval:** approve the exact new access-gate and group catalog-v2 hashes, metadata scopes and target. Run gate first; require every boolean and transport/target check, then catalog v2. Stop after inspection, sanitize results and classify compatibility. No financial test SELECTs or intentional denied row reads are needed; effective privilege builtins provide metadata checks.
5. **Contract approval:** group owner and responsible authentication/ingestion owners accept actual principal/membership/audit/key contracts, issuer/synthetic scope and unchanged interfaces. Do not infer approval for real Jason-auth integration from a synthetic principal.
6. **Isolated verification approval:** test the *new group-target alternative*, ACL defaults and audit grant binding on a fresh approved matching-version local/staging environment, with synthetic data and mocked GPT. Current native results do not cover this new variant or inspector scripts. No Production backup export/copy or paid environment is implicitly approved.
7. **Migration execution approval, later:** review final target-specific checksum, conflicts, recovery/restore evidence, lock/statement timeouts/window and postchecks. Apply only the approved group-target file, never original 005 or 001–004. This step requires a new explicit approval after inspection and isolated tests; no deployment commands are supplied here.
8. **Postcheck / retirement approval:** read-only catalogs verify expected objects/ACLs and unchanged logical neighbors, allowing intended RI-internal additions. Any behavioral Production write requires its own scope. Owner-approved inspector retirement may disable the *new* login, revoke its CONNECT and drop it only after sessions/dependencies are checked; no CASCADE or change to other roles. Existing passwords are never reset to obtain access.

Backup/restore readiness for group migration remains unverified: require group-authorized recoverability evidence, approved data/role/schema scope, isolated restore proof, RPO/RTO and incident owner before mutation. Backup/data export is a separate operation, not part of catalog access. Failed migration transactions roll back; after a successful install, prefer disabling optional writers while retaining immutable evidence. No destructive rollback of teammates' data or global restore is authorized.

## 6. Verification evidence and unresolved risks

This task performs only local source checks and document/SQL authoring. No SQL engine is invoked, no roles/credentials are created/changed, and no Supabase connection is made. The new SQL is **not parser/runtime/native verified**. Read-only defaults are not a substitute for effective privilege checks. PUBLIC privileges, extension callability and managed provider metadata visibility may prevent this strict inspector from being usable; fail closed without broadening it.

Retained earlier results: **14 GPT native passes** included within **157 passes / 0 failures / 1 skipped web journey**. They remain accurate for the original local 005 baseline only. They are not passes for these new role/gate/group-variant files, nor hosted certification. No tests are rerun for preparation.

Remaining blockers are owner approvals; fresh project/main-branch attestation; ability to provision a genuinely catalog-only role under current PUBLIC grants; private inspector credentials/verified TLS; live dependency/ACL/RLS/audit findings; identity/ingestion owner acceptance; matching-version isolated tests; and backup/recovery plus separate migration approval.

**Stop here for approval before any group operation.** No owner provisioning, credential activation, read-only database session or GPT migration operation is performed by preparing this package.
## Preparation checks

Local lexical checks passed for the nine-statement access gate and 36-statement group inspection revision: transaction/session controls and catalog SELECT/CTE forms only, READ ONLY transactions, no application/Auth row reads or user-routine invocations. The owner file was checked for disabled-role creation, CONNECT-only explicit grant, no private-schema/table grant and no credential literals. The group migration body reverses exactly to original 005 after the two documented substitutions. Original migrations 001–005 and the prior inspection file are unchanged; `git diff --check` passed. These checks do not invoke a SQL engine or establish runtime/platform compatibility.
