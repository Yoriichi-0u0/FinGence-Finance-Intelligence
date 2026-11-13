# Group GPT migration 005 deployment — COMMITTED_VERIFIED

13 November 2026 (Asia/Singapore).

## Authorization and artifact

The authorized group owner explicitly approved execution and action-time SELECT/INSERT grants to fingence_db04_group_runtime on only the two new forced-RLS GPT evidence tables. Owner explicitly accepted deployment without a backup. No backup, export or restore was performed or claimed.

Live target: FinGence-Production / zmtdozblpvtjniehwjrw / Production main. SQL Editor database and executor: postgres. Local branch: feature/ai06-gpt-integration-celester.

Unchanged file: supabase/sql/db04-group-access-review/02-gpt-005-group-compatibility-review.sql
SHA256: e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e
Full editor text copied back matched file exactly: 10,616 characters. One BEGIN and final COMMIT. No SQL modifications or migration 001–004 replay.

## Actual commit

Preflight found 11 existing tables and zero GPT table/function conflicts. Submitted migration once. Supabase heuristically warned of missing RLS because the reviewed SQL enables/forces it dynamically inside a DO block. Chose execution without editor-added SQL, preserving the exact reviewed transaction; the file's own ENABLE/FORCE RLS executed. SQL Editor reported **Success. No rows returned**. Subsequent independent read-only catalog transaction observed committed objects. No error, uncertain commit or retry occurred.

## Actual verification

Captured all 13 reviewed catalog result sections. The first three sections were read again only to repair a truncated local evidence capture; no migration retry or local test rerun.

- gpt_runs (22 columns) and gpt_items (19 columns): present, owner postgres, ENABLE and FORCE RLS.
- Eight validated tenant-bound foreign keys, including group-synthetic memberships; two primary keys, deterministic uniqueness, three valid/ready unique indexes and 38 CHECK constraints. Outcomes constrained to UNRESOLVED.
- Two SECURITY INVOKER functions, pinned pg_catalog search path, owner-only EXECUTE ACLs.
- Five enabled application triggers: two immutable, two deferred completion and run audit. Three policies: organization scopes and restrictive run actor binding.
- Runtime effective SELECT/INSERT only, no excess table/column rights or grant option. Existing test runtime inherits access. anon, authenticated, service_role and group/test brokers have no table/column rights. No role, membership or credential changed. Owner retains normal owner rights.
- Audit function uses caller transaction and existing PERSISTED/session-grant audit chain. No Production evidence insertion or behavioral smoke test performed.
- Totals: 13 tables, 31 foreign keys, 20 indexes, 16 noninternal triggers, 19 policies.

## Existing integrity

Read-only repeatable-read comparison against preserved completed Production inspection: **26 catalog sections compared; all_unchanged=true; changed_sections=[]**. Excluded only new GPT objects/ACLs and new internal FK dependency triggers referring to GPT objects. Parent tables necessarily gain internal FK dependency triggers; pre-existing user triggers remain unchanged.

Coverage includes original 11 table ownership/RLS/ACLs, columns/defaults, constraints, indexes, policies/triggers, identity/auth dependencies, helper definitions/ACLs, role flags/memberships, effective existing permissions, sequence/schema/default grants, event triggers, captured public ingestion objects and auth security definitions. Deterministic decisions and E5 definitions unchanged. No financial/auth/application rows were read or modified. This establishes catalog integrity, not row-by-row data equality or end-to-end teammate application behavior.

## Limitations and recovery

No verified backup exists: explicit owner waiver recorded. Native/regression evidence reused without reruns. No Groq/provider activation, hosted application wiring, Git push/merge, Vercel deployment or unrelated schema/permission changes. Schema deployment alone does not activate GPT inference. An authorized application smoke test remains a separate task.

No automatic rollback/drop/replay. Preserve evidence and diagnose future errors; restoring Production or dropping evidence requires new coordinated approval. Original migration and security files remain unchanged.

Machine-local evidence: .local/reviews/gpt-005-deployment-20261113/. Includes commit-success.png, integrity-success.png, AX catalog captures, parsed metadata, executed verification SQL and sanitized summary. Baseline comparison SQL contains catalog metadata and stays private, excluded from ZIP. All verification transactions were read only and ended ROLLBACK. No financial data or secrets included in review package.
