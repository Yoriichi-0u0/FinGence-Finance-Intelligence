# Exact isolated development approval request

Target: personal FYP A fhipzomczevbpybezzxu / postgres. Start 93115fd.
Owner explicitly waived a new backup for this disposable milestone and stopped
encryption work. That waiver covers no mutations itself. No backup is claimed.

Proposed exact SQL, not executed hosted:

1. supabase/sql/db04-development/install-review.sql
   SHA256 3f9617498f5b3df7658d8bf74387b17b18a57ddca35939885628077524b082d8.
   One atomic transaction, compiled from reviewed identity/DB04 SQL, mapping both
   missing M2/M3 dependencies into fingence_db04_dev_identity. It creates that
   synthetic-only namespace, five identity tables and broker/lifecycle functions;
   fingence_reconciliation with eleven tables, forced RLS, immutable evidence,
   scoped principal and audit-grant FK; nonlogin fingence_db04_dev_broker and
   fingence_reconciliation_runtime roles. It preserves the original source files.
   Only new objects' ACLs are sealed against PUBLIC/anon/authenticated/service_role.
   No public foundation tables, constraints, DB02 triggers, existing grants or Auth
   objects are modified. No fingence_m2/fingence_m3 namespace is created.
2. supabase/sql/db04-development/synthetic-seed-review.sql
   SHA256 749f241da91e70260f1c02ca3a72b8e0ac4f3e52d31bde96a086a260a3e83334.
   Creates two restricted logins: db04_dev_runtime inherits only reconciliation
   runtime; db04_dev_broker_login inherits only development broker, which can
   issue/revoke capabilities but cannot read financial tables. No passwords in SQL.
   Seeds exactly two synthetic organizations/states/users/Finance memberships in
   the isolated namespace; no provider Auth users or real identity mappings.

Approval is also requested for private masked password provisioning for those two
new logins, ignored private server configuration, and the synthetic test below.
Neither owner nor inspection login will be used as application runtime. The
synthetic authority runs in a dedicated test-mode CLI, not a public route or real
Supabase authentication. The fixed development broker adapter rewrites only the
two internal issuance/revocation statements; arbitrary SQL is rejected.

Synthetic write scope: existing registered fixtures bank.csv and ledger.csv under
tests/reconciliation-persistence/fixtures, SHA256 respectively
d496b00bcc826e6833770d373c8977fd4ff4163416e2c4e2e1c50938a9b9c2ec and
d71e68cb8aae56e87c86b9106fe8ff96f674d08f31111f79117640d1dbbf6be4.
One BANK/LEDGER pair, two accepted transactions, one stable job/context, source
documents/references, deterministic proposals/decisions/cases, fuzzy and actual
offline E5 ranking batches, independent verification, and append-only audit.
Repeated reads/process calls may add audit and short-lived synthetic lease rows;
they must not duplicate jobs/transactions. No financial assignment is auto-approved.
Negative tests use the second synthetic organization. All rows are confined to the
two new schemas. No existing public financial record is read or changed.

Immediately before execution, verify exact hashes, fixed direct target/database,
owner identity/TLS and catalog absence of every new schema/role. Any conflict or
guard failure stops. Each SQL file is atomic; no automatic retry or DROP cleanup.
If seed fails after install commits, leave the new empty schema installed and
report partial progress; do not replay installation. No application data is seeded
until new-object permissions are sealed. Password setup and runtime admission
failure stop before financial writes. Never retry an uncertain financial COMMIT.

Verification: independent catalog checks for eleven forced-RLS tables, role flags,
new-object ACLs and safe function paths; run createReconciliationBackend through
the development broker, compare exact amounts/fingerprints/processing ID and
stored decisions/rankings/verification evidence; read five financial models;
recreate connections and verify duplicate reuse and cross-org denial. Existing
Phase 1 dashboard, hosted routes, Vercel and team Production remain unchanged.
PostgreSQL 17.11 managed compatibility is verified only when approved execution
actually succeeds; current local install uses PostgreSQL 18.

Local evidence: exact atomic install and seed succeeded in a fresh native cluster,
eleven forced-RLS tables, two synthetic users, zero production identity namespaces.
Broker allowlist tests: 2 passed/0 failed/0 skipped. TypeScript, focused lint and
server-boundary checks passed. Initial local duplicate CREATE SCHEMA was corrected
before final checks; no hosted SQL ran. Existing full-pipeline local evidence is
unchanged. Real hosted persistence remains NOT EXECUTED pending this approval.
