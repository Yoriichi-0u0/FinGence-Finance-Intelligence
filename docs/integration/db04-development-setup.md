# Safe FYP A development setup

The owner confirms there is currently no approved isolated target. Do not use
FYP A main/Production for this work. No hosted integration has been executed.

Shortest next action: in the Supabase dashboard choose New project, select an
eligible Free organization, name it `fingence-db04-development`, generate/store
its database password privately, choose the region and create the project only
if the confirmation shows no associated cost. If no free capacity is available,
stop and request cost approval. Do not upgrade or modify FYP A. After provisioning,
share only the new project reference and isolation approval; credentials stay in
secure server configuration. See the official billing guidance:
https://supabase.com/kb/troubleshooting/keeping-free-projects-after-pro-upgrade-Kf9Xm2

Phase 3 catalog preflight now returns prerequisite columns, validated constraint
definitions, security-function owners/ACLs/search-path settings, installed
extensions and RLS policy definitions. These are read-only diagnostics for manual
compatibility review, not automatic deployment approval. DB04 uses built-in
PostgreSQL SQL/PLpgSQL facilities; no extra extension is installed by its migrations.

1. An authorized project owner opens FYP A in the Supabase dashboard and checks
   branch availability and applicable billing before creating infrastructure.
2. If available, use the branch selector to create a development preview branch.
   Leave **Include data** disabled. Do not merge a database branch into Production.
   Do not connect this task to automatic Production deployment.
3. Wait for branch provisioning. Record the branch ID, distinct project reference,
   parent Production reference and isolation evidence. Verify the selected branch
   before opening its connection panel. A development name alone proves nothing.
4. If branching is unavailable, obtain approval for a separate development project.
   Do not change Production plan, configuration or credentials as a workaround.
5. Store the development-only connection securely in server environment configuration
   as SUPABASE_DATABASE_URL. Never put it in NEXT_PUBLIC variables, Git or chat.
   Retain TLS certificate validation; use SUPABASE_DATABASE_CA_CERT only for an
   approved certificate chain. Do not disable validation to solve connection errors.
6. Use separate migration and restricted runtime identities. Review actual role
   capabilities, schema ownership, SECURITY DEFINER ownership and prerequisite
   definitions. Custom dashboard-created roles may not be copied into branches.
7. Run the catalog preflight through the existing PostgreSQL adapter. Compare actual
   database/role identity and M2/M3 dependencies with the independently approved
   target. The hosted-target guard checks direct host/ref/role/TLS configuration;
   it does not independently establish approval or hosted authentication.
8. Do not automatically install local M2/M3 auth schemas. Jason must approve the
   hosted identity boundary and required additive migrations first. Preserve C1
   schema snapshots and compare after migration. Current SQL dependency ordering
   is documented in db04-hosted-preflight.md; existence alone is insufficient.
9. On the verified development target only, execute reviewed migrations and the
   synthetic workflow using restricted roles. Record acknowledged write/read,
   fingerprints, decimals, reconnect, concurrent duplicates, rollback, uncertain
   commit and cross-tenant tests separately from local PostgreSQL results.
10. Keep all financial HTTP routes disabled until hosted auth is independently
    verified. Update PR #57 with actual hosted evidence; do not merge it.

Official references checked for these steps:
- https://supabase.com/docs/guides/deployment/branching/dashboard
- https://supabase.com/docs/guides/deployment/branching

AI06 follow-up inspection confirms AI02 fuzzyScore consumes research Features and
returns ranking evidence, not financial verification. Its fixed research date
policy is two days; the persisted cash contract explicitly uses bank VALUE_DATE.
A future separately versioned projection must preserve that distinction and pass
independent source/financial checks. No research scorer, threshold or frozen
evidence was copied, modified or represented as live inference by this increment.
