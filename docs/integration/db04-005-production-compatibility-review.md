# DB04 migration 005 — Production compatibility review plan

Prepared 12 November 2026. **Static review only. No database connection or SQL execution.**

| Binding | Intended value | Evidence status |
| --- | --- | --- |
| Source Git branch | `feature/ai06-gpt-integration-celester` | Verified locally |
| Supabase project | Group `FinGence-Production` | User-declared; immutable project ID/connection binding not supplied or inspected |
| Supabase database branch | `main` | User-declared; distinct from the source Git branch |
| Schema | `fingence_reconciliation` | User-declared; live catalog uninspected |
| Baseline | 11 existing reconciliation tables | User-declared; names/definitions must be checked |
| Migration | `supabase/sql/db04-005-gpt-evidence-review.sql` | SHA256 `7813c97657cb947e950d23d88d7e2666ed9a57dc8b72daa73c8bc2a603a9ff92` |

**Decision: 005 is structurally standalone once its existing dependencies are verified. Production compatibility is PENDING, not established. Never reinstall 001–004, local bootstrap/seed SQL, or personal FYP A identity scripts.**

## Deliverables and current boundary

- `supabase/tests/db04-005-production-catalog-review.sql`: unexecuted, catalog-only inspection script, intentionally outside migration/install manifests.
- This document: prerequisites, exact delta, review gates, risks and recovery requirements.
- Verified temporary review ZIP: these new deliverables, frozen 005 and 001–004 reference copies, retained local native report and checksum manifest. Reference files are not an execution sequence.

This task adds only the inspection SQL and this report. Existing migrations, Production TypeScript, routes, credentials, Supabase settings and previous evidence are not changed. No SQL parser connected to a database, application test, migration, provider call, Git push, merge or deployment is authorized or performed in this task.

## What the local evidence establishes

[Local native verification](db04-gpt-native-verification.md) used fresh disposable **PostgreSQL 18.6** clusters and synthetic identities/documents. Retained final results are **157 passed, 0 failed, 1 skipped** across 21 test files. The **14 GPT native passes are included in the 157**, not added to them. All 14 GPT native cases executed, with zero failed/skipped. The final run also contains 32 existing DB04 native passes and real pinned offline E5 checks.

The single skipped case is the explicitly excluded real Next web-server journey. The separate recovery-lab suite was excluded entirely and is not a pass or a skip in that result. The earlier ten approval-gated native skips are historical and were never counted as passes. These results do not establish the group's PostgreSQL version, hosted authentication compatibility or Production recovery readiness. No tests are rerun for this documentation-only review.

Local verification found and corrected default-ACL leakage on new GPT objects, tested forced RLS under a nonsuperuser table owner, concurrent idempotency, immutable evidence, tenant/source/record FKs, atomic audit rollback, abstentions, repeated processing, reconnection, and deterministic/E5 preservation. The local catalog comparison captured logical object properties and excluded FK-internal triggers; it must not be interpreted as zero change to every parent catalog entry.

## Read-only inspection plan — separate access approval required

Before opening any session, obtain explicit approval for **catalog inspection only** of the exact group project ID and `main` branch, using an existing authorized metadata inspection identity. Do not reuse a personal FYP A connection or rely on an environment fallback. No connection or credential provisioning is included here. `current_database()='postgres'`, display names and a source Git branch cannot prove a Supabase project/database-branch identity; require operator/control-plane attestation through the group's approved process.

After that future approval, the operator may run the prepared SQL as one session. It opens a REPEATABLE READ, READ ONLY transaction, forces `search_path=pg_catalog`, uses bounded local timeouts and ends with ROLLBACK. It contains only transaction/session controls, SELECT/CTE catalog reads and PostgreSQL metadata builtins. It does not call principal(), authorized_organization(), current_grant_id(), auth.uid(), issue/revoke-grant routines, sequence allocation, or financial/user/session queries. No SET ROLE, temp objects, DDL, DML, row counting of business tables, EXPLAIN ANALYZE, validation scans or exports are included.

Capture the result sets as privileged review evidence. Role relationships, object ownership, policy expressions and allowlisted routine bodies are security-sensitive metadata; do not publish them with credentials or connection details. A denied catalog read is a blocker, not permission to elevate or change grants. On any SQL error/timeout, rollback/close the session; do not relax controls or retry against another target. The script is statically reviewed and **unexecuted**; it is not claimed to have been parsed/validated by the group's PostgreSQL engine.

| SQL sections | Review question / acceptance condition |
| --- | --- |
| 01 and builtin signature inventory | What exact version runs here? Read-only state and needed JSONB/JSONPath/ACL features are present. Only 18.6 has native evidence; a different target version requires an approved isolated test on that version. |
| 02–03 | Are the exact 11 baseline tables present as expected ordinary/approved table kinds? Extra/missing objects or different schemas block automatic assumptions. |
| 04–07 | Are columns/types, tenant keys, validated nondeferrable PK/unique keys and FK lineage compatible? Do NOT repair or reinstall prerequisites. |
| 08–11 | Are RLS, immutable triggers, routine signatures/owners/search paths and Jason's authoritative tenant/session resolution valid? Catalog dependencies can omit PL/pgSQL/dynamic dependencies; source/owner review is also required. |
| 12–16b | Is the actual application login restricted, separate from the migration owner, and without effective superuser/BYPASSRLS or unsafe inherited role capability? Verify effective privileges as well as direct grants and column ACLs. |
| 05, 09, 16b–17 | Can the existing audit contract accept the trigger's PERSISTED insert and the service's READ insert, including extra required columns, defaults, identity/grant binding, triggers and sequence permissions where required? No auth routine is invoked to test this. |
| 18–19 | Which creating-role default ACLs and DDL event triggers apply? The ACL fix touches only new objects. Event-trigger side effects need review before assuming isolated DDL behavior. |
| 20 | Are every new table/type/index-prefix and zero-argument function name unused? Any collision/partial install blocks execution; no IF NOT EXISTS, DROP or CREATE OR REPLACE workaround. |
| 21 and captured baseline | Preserve neighboring ingestion/financial/Auth object metadata. Broader team-owned schemas must be identified by their owners before planning a full before/after comparison. No business data is inspected here. |

## Exact standalone prerequisites

The expected baseline table names are `documents`, `jobs`, `job_sources`, `transactions`, `proposals`, `decisions`, `cases`, `reviews`, `audit`, `rankings` and `proposal_verifications`. A count of 11 alone is insufficient.

Migration 005 directly needs these already-existing reference keys, with matching UUID/text types and usable immediate unique/primary indexes:

| Referenced object | Required key, in reference order |
| --- | --- |
| fingence_reconciliation.jobs | `(organization_id uuid, processing_id text)` |
| fingence_m2.memberships | `(user_id uuid, organization_id uuid)` |
| fingence_reconciliation.job_sources | `(organization_id uuid, processing_id text, sha256 text, kind text)` |
| fingence_reconciliation.transactions | `(organization_id uuid, processing_id text, kind text, record_id text)` |

It also requires the existing `fingence_reconciliation_runtime` role; schema privileges appropriate to an approved separate migration owner; REFERENCES privileges on the parent keys; PL/pgSQL and the builtin features used by 005; and the existing zero-argument functions:

- `principal()` returning `(user_id uuid, organization_id uuid)` from Jason's approved server-established identity/active Finance membership/session context, not browser tenant claims.
- `authorized_organization()` returning uuid and enforcing the approved tenant/lifecycle/suspension boundary.
- `immutable()` returning trigger and rejecting UPDATE/DELETE.

The existing runtime must already have the appropriate schema usage, helper execution and audit-insert/default privileges. **005 does not grant or repair these existing rights.** Runtime NOLOGIN may be the shared role inherited by a separate restricted login; review both identities and their full role paths. Ordinary principals must not gain owner/BYPASSRLS capability through membership or role switching.

The existing audit insert shape is `(organization_id, processing_id, actor_id, action='PERSISTED')`; its generated identity/timestamp and any additional required fields must be satisfiable by approved defaults/triggers. In particular, an extra `session_grant_id NOT NULL` column requires the already-approved grant default, signature, source relation and actor/tenant FK behavior. This review does not presume the group's identity layout matches the old local or personal hosted contracts. Do not copy the repository's FYP-A-specific issuer/authority configuration into the group.

The current TypeScript processing/persistence reader also expects the full protected eleven-table DB04 context and the same trusted source/policy contracts. A successful SQL CREATE is not evidence that those application/authentication contracts match. Current GPT application methods remain local-only; no hosted activation is part of migration review.

## Exact proposed migration 005 delta

Every explicitly qualified new object resides in the existing `fingence_reconciliation` schema. No new role, schema, extension, view, application route or sequence is created. The two anonymous DO blocks are execution blocks, not stored routines.

| New object | Specification |
| --- | --- |
| `gpt_runs` table | 22 columns: organization_id, processing_id, evidence_id; bank_kind, ledger_kind; bank_sha256, ledger_sha256; created_by, created_at; model_version, prompt_version, schema_version, proposal_version, verification_policy, financial_policy; source_fingerprint, request_fingerprint, proposal_fingerprint, verification_fingerprint; outcome; suggestion_count, abstention_count. |
| `gpt_items` table | 19 columns: organization_id, processing_id, evidence_id; item_type, ordinal; bank_kind, ledger_kind; bank_claim, ledger_claim, record_claim; bank_record_id, ledger_record_id, abstention_kind, abstention_record_id; explanation, outcome, reasons, verification, created_at. |
| Run PK | `(organization_id, processing_id, evidence_id)`; one backing unique index. |
| Run unique constraint | `(organization_id, processing_id, model_version, prompt_version, schema_version, source_fingerprint, request_fingerprint, proposal_fingerprint, verification_fingerprint)`; one backing unique index. |
| Item PK | `(organization_id, processing_id, evidence_id, item_type, ordinal)`; one backing unique index. |
| `gpt_complete()` | New zero-argument PL/pgSQL trigger function, SECURITY INVOKER, search_path pg_catalog. At commit, checks expected item counts and contiguous per-type ordinals. |
| `gpt_audit()` | New zero-argument PL/pgSQL trigger function, SECURITY INVOKER, search_path pg_catalog. Inserts one existing-format PERSISTED audit event after a run insert. |
| `gpt_runs.gpt_run_audit` | AFTER INSERT, FOR EACH ROW, executes gpt_audit(). |
| `gpt_runs.immutable`, `gpt_items.immutable` | BEFORE UPDATE OR DELETE, FOR EACH ROW, reuse existing immutable(). |
| `gpt_runs.gpt_complete`, `gpt_items.gpt_complete` | AFTER INSERT constraint triggers, FOR EACH ROW, DEFERRABLE INITIALLY DEFERRED, execute new gpt_complete(). |
| `gpt_runs.organization_scope`, `gpt_items.organization_scope` | Permissive ALL policies; USING/WITH CHECK organization_id=authorized_organization(). Default policy role scope is PUBLIC; table grants remain restricted. |
| `gpt_runs.actor_binding` | Restrictive INSERT policy; created_by=(SELECT user_id FROM principal()). |
| RLS flags | ENABLE and FORCE ROW LEVEL SECURITY on both new tables. |

There are **8 explicit foreign keys**, all tenant/job scoped:

1. Run `(organization_id, processing_id)` → existing jobs key.
2. Run `(created_by, organization_id)` → existing memberships key.
3. Run `(organization_id, processing_id, bank_sha256, bank_kind)` → existing job_sources key.
4. Run `(organization_id, processing_id, ledger_sha256, ledger_kind)` → existing job_sources key.
5. Item `(organization_id, processing_id, evidence_id)` → new run PK.
6. Item `(organization_id, processing_id, bank_kind, bank_record_id)` → existing transactions key.
7. Item `(organization_id, processing_id, ledger_kind, ledger_record_id)` → existing transactions key.
8. Item `(organization_id, processing_id, abstention_kind, abstention_record_id)` → existing transactions key.

All use the existing SQL defaults for referential actions; no CASCADE action is specified. Suggestion bindings may be NULL for hallucinated IDs while exact model claims remain visible. Non-NULL bindings equal the corresponding claim and must reference actual records. Abstentions require a non-NULL source role/record. No financial record is created by a claim.

The source contains 17 run CHECK expressions and 21 item CHECK expressions, plus declared NOT NULL constraints. They pin model/prompt/schema/proposal/verification/financial versions; validate fingerprints/roles/bounds; require UNRESOLVED; constrain suggestion/abstention topology and claim lengths/bindings; restrict verification keys/size; require string-array reasons containing ASSIGNMENT_POLICY_NOT_APPROVED. Timestamps use clock_timestamp(). The frozen SQL is the authoritative expression-level specification; generated constraint/index names follow the target PostgreSQL rules.

PostgreSQL also creates supporting dependency/catalog entries, composite row/array types, backing indexes and version-dependent TOAST objects. FK implementation adds internal referential-integrity triggers/dependencies on both new and referenced tables, including existing jobs, memberships, job_sources and transactions. These are structural consequences, not financial row updates or changes to Jason's membership lifecycle logic. Post-approval comparison must distinguish these expected additions from changed existing user triggers/policies. The catalog SQL inventories internal triggers explicitly.

### Permission changes, limited to new objects

- Revoke ALL from PUBLIC on both new tables and both new trigger functions.
- Inspect ACLs on those four new objects and revoke ALL direct grants from each non-owner grantee, including managed-default grants or excessive runtime defaults. No default-ACL record, existing grant or role membership is changed.
- Grant only SELECT and INSERT on both new tables to the already-existing fingence_reconciliation_runtime role. No grant options, runtime UPDATE/DELETE/TRUNCATE or new-function EXECUTE grants are added.
- Keep object-owner privileges and administrative PostgreSQL capabilities as the existing operational trust boundary. Forced RLS does not neutralize superusers/BYPASSRLS roles, and owners can change schema/triggers. Review effective inheritance separately.
- Reuse existing schema/helper/audit/identity-sequence privileges where required. No broad ALL TABLES/ALL FUNCTIONS grant/revoke is issued on the existing schema.

Applying 005 alone creates no GPT rows and does not fire its run audit trigger. Later explicit application persistence inserts new GPT evidence and existing protected audit rows atomically. No approval/clearing/posting/financial decision update occurs; all GPT outcomes remain UNRESOLVED.

## Preservation of teammates' work

Static source review confirms no direct DDL/DML targets Chia's ingestion tables, C1/V2 records, Jason's authentication tables/routines, existing deterministic proposals/decisions, E5/fuzzy rankings, verification snapshots or other teammate objects. Existing memberships and financial source tables are referenced, not altered at the application/schema-definition level. Auth issuer/session/membership contracts are not replaced; no credentials or claims are stored. The only intended later write outside the new tables is the existing DB04 audit insert.

This is a scope guarantee from the proposed SQL, not live catalog/data certification. Parent RI-internal additions, DDL event triggers, existing audit-trigger side effects, locking and privileges can affect operation and must be reviewed. No hosted teammate data was read or changed here. If inspection finds an incompatibility, stop; do not repair Chia/Jason/other owners' objects under this AI06 approval.

## Prerequisites, backup and recovery requirements

Before any separately approved execution:

- Verify exact project ID/database-branch identity, catalog results, migration checksum, current migration history and absence of partial/conflicting 005 objects. Do not treat the eleven-table count or an old personal report as proof.
- Resolve every version/key/type/function/audit/ACL/identity mismatch through the appropriate owner. If a target differs from PostgreSQL 18.6, run the frozen SQL/security checks in a separately authorized isolated matching-version environment first. No Production behavior tests are implicitly approved.
- Obtain Jason's confirmation of the real authentication/lifecycle/tenant mapping and Chia/other owners' confirmation of referenced interfaces and acceptable lock impact. Do not change their work to make the migration pass.
- Have the group's authorized operator attest a recent recoverable database backup or already-provisioned recovery mechanism: scope/time/checksum or provider reference, retention, role/grant/schema coverage, restore destination, measured restore evidence, agreed RPO/RTO and responsible owner. Availability of backups/PITR is unknown; do not assume a plan feature exists or enable one.
- Backup/export and restore access are separate from metadata approval. Do not export Production financial/Auth data or copy it into this workspace. Validate recovery in a separately approved isolated destination, never overwrite the group database as a test. A whole-project restore could erase teammates' later work and requires coordinated separate approval.
- Agree a change window, bounded lock/statement timeouts in the approved executor session, stop-on-error/rollback behavior, migration-owner/runtime separation and an incident contact. 005 includes its own BEGIN/COMMIT and no timeout settings; the runner must be reviewed without silently changing the approved SQL hash.
- Review DDL event triggers and locking effects on referenced tables. Although new tables start empty, FK/DDL locks can conflict with live traffic. No business-table scan or validation of unrelated legacy constraints is part of 005.

If the migration fails before COMMIT, rollback the whole transaction and record the error; do not rerun 001–004 or loosen RLS/grants. If it commits, prefer disabling optional GPT writers and retaining new immutable evidence while investigating. No destructive down/CASCADE script is proposed. Table/evidence removal or global restoration requires separate approval, preserved audit/evidence and dependency/teammate-impact review. A post-commit application rollback is not a license to delete evidence.

## Approval checklist and remaining blockers

- [ ] **Access approval:** exact group project ID + main branch + inspection identity bound; permission limited to the unexecuted catalog script. Currently NOT APPROVED.
- [ ] **Catalog review:** eleven table names/definitions and dependency/role/ACL/RLS/trigger/auth/audit compatibility established. Currently UNINSPECTED.
- [ ] **Version and owner review:** matching-version isolated verification if needed; Jason/Chia/other interfaces and effective restricted runtime/owner capabilities accepted. Currently UNVERIFIED for Production.
- [ ] **Recovery:** target-specific backup/restore evidence, RPO/RTO, responsible operator and incident plan accepted. Currently UNVERIFIED.
- [ ] **Exact execution approval:** approve only checksum-pinned 005, target, owner/session controls/window and post-check scope. Explicitly exclude reinstalling 001–004, identity bootstrap, credentials, provider dispatch and app rollout. Currently NOT APPROVED.
- [ ] **Post-execution review, only after that future approval:** rerun approved catalog reads; expected table count becomes 13 if exactly eleven baseline tables were confirmed; check the two new tables, three indexes, two functions, five explicit triggers, three policies, constraints/ACL sealing and expected internal FK additions. Compare existing logical definitions/ACLs without mistaking intended internal dependency additions for drift. No Production test inserts or provider calls without their own scope.
- [ ] **Separate application/provider approval:** current server-only/local-only guards, identity binding, failure receipts and durable dispatch limits are outside this migration. No hosted app/provider activation is implied.

**Stop point:** deliver these files and wait. No group database access, SQL execution or application of 005 is permitted by this preparation task. Request separate read-only access approval first; applying 005 requires a later explicit deployment approval after the blockers are resolved.
## Preparation-only verification

Static lexical inspection passed for the 36 statements in the catalog script: only BEGIN, SET, SELECT, WITH and ROLLBACK forms; explicit REPEATABLE READ READ ONLY; no mutating forms, user authentication routine calls or direct application/Auth table reads. This is a lexical/source check, not PostgreSQL parser/runtime validation. `git diff --check` passed. The frozen 005 checksum and unchanged 001–004 source were verified locally, and retained machine-readable results confirmed 157/0/1 with all 14 GPT native cases passed. No SQL execution or application-test rerun occurred in this preparation step.
