# DB04 migration 005 — approved group inspection preflight result

12 November 2026 · `feature/ai06-gpt-integration-celester`

**Status: BLOCKED before connection. No live compatibility inspection was performed. Migration 005 is not cleared for the group.**

The user authorized catalog-only inspection of Group Supabase `FinGence-Production`, branch `main`, with a verified restricted inspector and no privileged fallback. The configuration prerequisite could not be satisfied, so the requested stop condition was honored.

## Actual preflight findings

| Check | Finding | Consequence |
| --- | --- | --- |
| Group identification | Historical committed installation evidence identifies project `zmtdozblpvtjniehwjrw`, database `postgres`. Group connection metadata is bound to that project. | This identifies a candidate group target, not current database/main-branch identity or live certificate/role proof. |
| Dedicated group catalog connection | None found in the relevant group/inspection env configurations across the existing repository worktrees. No relevant inherited process configuration was present. | Cannot authenticate as an approved group inspector. |
| Existing group connections | Owner, application financial-runtime and broker configurations are present. | All rejected locally before connection. A financial runtime or broker is not a catalog-only substitute. |
| Separate inspection connection | Targets personal FYP A and declares its personal inspection authorization. | Rejected locally; never connected or repurposed. |
| Transport evidence | A group CA path is configured and its file exists. | This is configuration evidence only. Peer certificate verification and actual TLS/connection identity were not attempted. |
| Live permissions | No connection exists through which to verify login capabilities, inherited privileges, ownership or absence of financial/Auth access. | Restricted inspection permission gate remains unmet. |

Private env values were parsed in-process to report classification/binding booleans and relevant configuration key names only. No URL, password, token, certificate contents, credential value, financial data or Auth/session row was emitted or saved in this report. No existing private script was executed; historical scripts were inspected as source only. No owner/service/runtime/broker login was attempted. The personal-FYP-specific inspection helper was not repurposed for group access.

## Reviewed SQL

The current `supabase/tests/db04-005-production-catalog-review.sql` matches the previously reviewed ZIP exactly:

`a024940f6016fa11ef09eac3709e430d9116b92f5a9ff4bda529545c29c9cd5c`

Its 36 statements passed a source/lexical check: transaction/session controls, SELECT/CTE catalog metadata and PostgreSQL metadata builtins only; REPEATABLE READ READ ONLY; fixed pg_catalog search path; bounded timeouts; ending ROLLBACK. No financial/Auth/session table reads, mutations, role switching or invocation of application authentication routines were found. This is not PostgreSQL parser/runtime certification. **Zero statements were executed**, including no live preflight query. There was no connection attempt to either Supabase project.

The reviewed script is frozen. If access is later available, a separately reviewed minimal catalog-only identity/permission gate is needed before its broad catalog sections: current role/database, nonsuperuser/NOBYPASSRLS/no privilege escalation or unsafe membership, no relevant object ownership, no effective financial/Auth/session table or column rights, and authenticated TLS on the explicitly attested project/main branch. Do not execute the prepared script first and use its later role result sets as retrospective authorization. No additional gate was executed or silently substituted into the approved SQL.

## Historical source finding — additional compatibility risk

Local Git object `943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9` contains:

- `docs/integration/db04-group-hosted-installation.md`: a dated 3 November installation report recording PostgreSQL 17.11 and eleven group reconciliation tables. These are historical observations, not findings from the current task.
- `supabase/sql/db04-group-review/install-review.sql`: group-specific synthetic identity schema `fingence_db04_group_synthetic`, memberships in that schema, runtime role `fingence_db04_group_runtime`, and group-specific principal/grant bindings.

Frozen migration 005 instead references `fingence_m2.memberships` and grants to `fingence_reconciliation_runtime`. Therefore the known historical group installation source is not the same dependency contract as the local 001–004 baseline used for the fourteen native tests. If the current group catalog still matches that source and lacks the original local dependencies, 005 cannot be applied unchanged. A missing original runtime role could also make the GRANT fail even if other objects resolve. Incompatible tenant membership universes could be unsafe even if similarly named objects happen to exist.

This is an actual static source mismatch, not a live catalog conclusion. The current existence of either namespace/role, PostgreSQL version, exact eleven-table definitions, constraints, FK targets, RLS, triggers, grants, auth or audit defaults remains **UNINSPECTED**. The reviewed catalog script inventories reconciliation FK/routine/role metadata but its explicit identity-column inventory assumes fingence_m2/m3; any needed group-synthetic coverage requires a separately reviewed revision. Do not silently alter or extend the approved SQL on the database.

No migration or authentication code was changed to resolve this finding. Do not create personal/local M2/M3 schemas on the group, replace Jason's authority, broaden roles, rerun 001–004, or modify Chia's ingestion to make 005 pass.

## Preservation and evidence

Connections attempted: **0**. Catalog statements executed: **0**. DDL/DML, financial/Auth/session row reads, permission/credential changes, Groq calls, Git push/merge/deployment: **0**.

Chia's ingestion, Jason's authentication, E5 evidence and other teammates' existing data/functionality were untouched by this task because no database operation occurred. Their current hosted catalog/data state is not certified. Migration 005 remains byte-identical at SHA256:

`7813c97657cb947e950d23d88d7e2666ed9a57dc8b72daa73c8bc2a603a9ff92`

Prior local evidence remains **157 passed / 0 failed / 1 skipped**, including **14 GPT native passes**. The skipped test is the excluded real web-server journey. None is a hosted-inspection pass, and no tests were rerun in this task.

Sanitized machine-readable result: `docs/integration/db04-005-production-inspection-result.json`. Only this report and that result are new task deliverables. No existing migration, reviewed inspection SQL, Production code or credential configuration was modified.

## What is required to resume

1. An existing, privately configured dedicated **group catalog-only** connection, exact project/main-branch attestation and CA/TLS binding. No role creation, password reset, grant change or owner fallback is implied; if provisioning is necessary, it requires its own authorized operator task. Credentials must remain outside chat and review artifacts.
2. Review the source mismatch with the responsible owners and review the minimal identity/permission gate and any group-specific catalog coverage before executing additional SQL. Current catalog access authorization does not authorize migration rewrites or application.
3. Once the target and restricted permissions are verifiable, perform the approved metadata-only inspection. Any denied query, mismatch or uncertain target stops work. Determine compatibility from actual catalog results, not the historical report.
4. Applying any reviewed migration still requires separate approval after live findings and recovery prerequisites are resolved.

**Final readiness: BLOCKED. Stop after preflight; no migration application.**
