# AI06 group GPT application composition

13 November 2026. Branch feature/ai06-gpt-integration-celester.

## Result and deployed contract

Server-only group-capability composition is implemented and verified offline against the deployed group-compatible 005 SQL and historical group baseline. No Production connection, schema changes, financial reads/writes or credentials were used for this task.

The deployed tables are **fingence_reconciliation.gpt_runs and fingence_reconciliation.gpt_items**, not gpt_evidence_items. Reused the exact names in the successful deployment record and migration SHA256 e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e. No alias/view/table migration introduced.

## Implementation

`lib/server/reconciliation/group-gpt-backend.ts` exports:

- `assertGroupGPTConnection`: a trusted-configuration-only check for the exact group direct endpoint, postgres database, port 5432 and certificate-verifying TLS; rejects owner/service/NOLOGIN group role credentials. It neither loads environment files nor connects. Must run against the actual restricted pool configuration before operator activation; a syntactically acceptable login is not proof of permissions.
- `groupGPTRuntimeDatabase`: checks the actual current/session identity and inherited privileges on the same connection at the start of every transaction. Requires a LOGIN inheriting the group runtime, excludes superuser/BYPASSRLS/role/database/replication administration, broker or owner ancestors, SET ROLE identities and evidence-table ownership. Requires both deployed tables with forced RLS, SELECT/INSERT and no excess mutations/column rights. Verifies the existing SECURITY DEFINER principal's pinned search path, group membership schema, issuer and admission version. Fails closed before service operations and does not cache approval across pooled connections.
- `createGroupGPTBackend`: composes the existing proposer and evidence persistence/retrieval services through that checked database. Accepts an existing group capability; does not accept caller tenant/actor identities, mint leases or treat browser JWTs as capabilities. No routes or default production startup changed.

The existing persistence implementation preserves organization/processing IDs, BANK/LEDGER IDs/source hashes, model/prompt/schema/policy versions, suggestions/abstentions and independently recomputed verification. Canonical evidence IDs and transactional advisory locks prevent duplicate inserts. Audit writes and completeness checks share the database transaction. Retrieval is audited and therefore also requires write approval on Production. Outcomes remain UNRESOLVED; no matching decision update or approval path added.

Existing local-only guards in the proposer and persistence service remain intact. Neither a Vercel environment nor NODE_ENV=production can execute these methods yet. No live Groq transport added or called.

## Authentication boundary and activation blockers

The actual deployed principal uses fingence_db04_group_synthetic users, memberships, organization_states and sessions. It requires issuer urn:fingence:db04:group-synthetic:1, group-synthetic-admission/1, an active Finance membership with the matching membership version, active organization, unsuspended user, and nonrevoked/unexpired server capability hash. Existing principal() sets and resolves that hash transaction-locally; tenant and actor come only from the database.

The generic createReconciliationBackend currently uses an older HostedAdmission with a different issuer and fingence_m2 grant functions. It was deliberately left unchanged: it cannot be silently repointed to the group synthetic admission or Jason's real login. A controlled activation still requires:

1. An approved login-to-group-capability adapter/owner contract. The group synthetic issuer is not a Supabase Auth JWT issuer; Jason's verified authentication must not be mapped implicitly. Existing issue/revoke group broker functions are separate from financial runtime and are not called here.
2. An owner-provided restricted group runtime pool/login, direct TLS configuration and private secret provisioning. No credential discovery, reuse, broker/owner fallback or connection was attempted. Operator must pin exact group project/main and call assertGroupGPTConnection, then pass that same pool to the composition. The database catalog alone cannot establish which Supabase dashboard branch a caller intended.
3. Separate approval to lift local-only activation guards, expose an authenticated internal route and execute a synthetic application smoke test against Production. This task intentionally does not lift them.
4. Separate explicit provider dispatch approval before any live Groq request. No Vercel settings, pushes, merges or deployments.

Thus **OFFLINE CONTRACT VERIFIED; PRODUCTION APPLICATION ACTIVATION BLOCKED**, not a claim of an active hosted connection or completed Production application smoke test. Migration 005 remains committed; no database work is required by this code change.

## Verification evidence

Focused result: 41 passed, 0 failed, 0 skipped across four files: 18 native group PostgreSQL tests, 8 GPT persistence unit tests, 11 proposer/provider unit tests and 4 new group-adapter unit tests. Native tests run in a fresh loopback PostgreSQL 18 cluster using only synthetic fixtures and the exact reviewed group migration. No hosted URL is accepted by the harness.

Coverage includes restricted-runtime composition, proposal/persist/retrieve, duplicate/concurrent reuse, reconnects, tenant isolation, actor binding, revoked/expired/non-Finance sessions, suggestions/abstentions/empty output/hallucinations, provider failure, audit rollback, child rollback, foreign keys, forced RLS and immutable evidence; deterministic/fuzzy/E5/protected reads remain compatible. E5 is an in-memory unit double in this suite, not a repeated model-quality benchmark. The new adapter unit tests cover direct target/TLS denial, fail-closed contract checks, same-connection repeated guards, option forwarding and retained Production activation guards.

Initial runner bootstrap attempts were blocked by pnpm metadata DNS and temporary-file permissions. Invoking installed tools directly with one thread resolved bootstrap. The first local native attempt could not connect due to sandbox loopback restrictions: 23 unit tests passed and 18 native tests skipped, not counted as passed. The final explicitly loopback-authorized run executed all 41 successfully. No Production or provider fallback was used.

TypeScript (tsc --noEmit --incremental false), focused ESLint, server boundary and git diff --check passed. Safe installed-tool invocations avoid package installation or registry access. Relevant regressions are recorded below after completion.

Changed scope: one new server composition, one new unit test, additions to the existing group native test, and this report. Existing service, proposer, persistence SQL, identity code, migrations, routes, ingestion, deterministic matcher and E5 implementation unchanged by this task. Pre-existing uncommitted work is preserved.

Relevant regression result: **63 passed, 0 failed, 0 skipped**, eight suites covering processing, rankings, independent verification, hosted identity, trusted ingestion, financial views, HTTP and development broker. Combined executed assertions in this task: **104 passed, 0 failed, 0 skipped** (41 focused + 63 distinct regressions).
