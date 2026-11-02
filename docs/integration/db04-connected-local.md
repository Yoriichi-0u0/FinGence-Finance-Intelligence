# Connected local processing read slice

Starting HEAD: 0dff994d779712f10238bf502fbff638cfe51544. Freshly fetched main:
cb5db4625ceca1cb94867a90a8a3edddbcf1e6ba. Neither branch was merged.

GET /api/db04/processing?processingId=<sha256> exposes one versioned processing
read response for Transactions and Reconciliation. It delegates authentication,
tenant resolution, RLS and atomic read auditing to the existing DB04 get service.
The response includes the same job, source fingerprints, exact transactions,
proposal decisions, unresolved cases and reviews. Authorization uses the existing
local M2/M3 Finance session Bearer token; no organization parameter is accepted.
Responses are no-store. No browser credential or database URL is returned.

The route requires NODE_ENV=development and FINGENCE_DB04_LOCAL=1, rejects Vercel,
non-loopback request/database hosts, forwarded hosts and cross-origin requests.
The actual database identity must be a nonowner, non-superuser, non-BYPASSRLS member
of fingence_reconciliation_runtime. The connection uses the existing pg adapter;
TLS handling is unchanged. There is no schema installation or session bootstrap
in the HTTP route. Configure the local restricted login securely in
SUPABASE_DATABASE_URL only after reviewed local migrations and local session
provisioning. Do not use a hosted or owner connection for this route.

Executed relevant suite: 588 passed, 0 failed, 10 skipped. This includes 19 native
PostgreSQL tests, one of which persists real fixture bytes then reads through the
HTTP handler using the restricted database login, verifies decimal/decision/context
identity and denies another tenant. It is a handler integration test, not evidence
of a running browser dashboard or a hosted API. Typecheck, focused ESLint and
server-boundary checks passed. Raw report: outputs/db04-ai06/connected-local.json.
Prior full-suite failures remain recorded; the complete project was not rerun.

Docker and Supabase CLI are absent. No local Supabase stack or hosted connection
was started. Native PostgreSQL migration, RLS, rollback, duplicate, reconnection
and uncertain-commit tests remain the executed database evidence.

To prepare local Supabase later, install Docker Desktop from its official vendor
distribution, start its engine, then use the official Supabase CLI npm package in
a separate ignored workspace, not linked to FYP A:

```powershell
New-Item -ItemType Directory -Force .local/supabase-db04
Set-Location .local/supabase-db04
npx supabase init
npx supabase start
```

Review generated config.toml and bind the local stack to loopback; resolve port
collisions before starting. Never run link, db push, db reset or seed against a
remote project. Apply only reviewed LOCAL prerequisites and DB04 SQL to the
verified new local instance. No local Supabase compatibility is claimed until
this stack actually runs and its tests pass. Official installation/workflow:
https://supabase.com/docs/guides/local-development/cli/getting-started

Ingestion remains the registered cash-source-v1 boundary. C1 VALID/WARNING
persistence is reused unchanged; C1 does not establish trusted BANK/LEDGER roles
or VALUE_DATE provenance. No C1/V2 adapter is fabricated. AI06 exact deterministic
proposals remain functional; fuzzy/E5 contract adapter and persisted ranking
evidence are still incomplete, and no live inference ran. The browser demo and
ProcessingRunner were not replaced. Dashboard wiring and a local authenticated
upload API are still required for an interactive connected workflow.

Hosted deployment remains a proposal only: inspect FYP A catalogs read-only,
preserve C1 definitions/data, review M2/M3 identity compatibility, migration/function
ownership and restricted grants, capture a verified backup/recovery plan, then
request explicit authorization for any hosted change. No hosted migration,
financial write, auth/RLS/Vercel change or paid project creation was performed.
