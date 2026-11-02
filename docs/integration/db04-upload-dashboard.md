# Local upload and dashboard slice

Starting commit: eb3a2cf48af504a8bc5375d73d184ee73a7ee71f.

POST /api/db04/processing now shares GET's environment, loopback, origin and
restricted database-role gates. Multipart input has exactly two `documents`
files, no caller organization or role claims. The streamed body is bounded at
1,050,000 bytes even without Content-Length; individual files are nonempty CSVs
up to 512,000 bytes. Server-registered SHA256 bytes determine roles, then the
existing persist service authenticates Finance and independently checks schema,
source accounting and scope. It commits transactions/decisions/audit atomically.
Unknown commit or rollback outcomes return 409 with no automatic retry.

The local Transactions and Reconciliation pages select the DB04 workspace only
with NODE_ENV=development, FINGENCE_DB04_LOCAL=1 and no VERCEL setting. Existing
Production page branches are preserved. Start the application with the local
restricted database connection securely configured as described in
db04-connected-local.md; apply reviewed local prerequisites beforehand. Supply
an existing supported local M2/M3 Finance session in the password field. The token
stays in component memory, never a URL or persistent browser storage. This does
not add a login/provisioning endpoint or change existing authentication.

Select the registered BANK and LEDGER CSV documents and choose Process documents.
The workspace POSTs them, then GETs the returned processing ID. Both view tabs use
that single validated `db04-processing-read/1` context, including source hashes.
Changing session clears the result. Requests cannot change session while upload
is active. Read failure clears the result; there is no browser demo substitution.
An uncertain outcome disables upload until investigation. No sample fallback or
automatic retry is introduced. The trusted default registry is unchanged; the
small committed test pair is registered explicitly only in the test composition.

Automated evidence:
- Relevant backend/security/ingestion/PoC suite: 590 passed, 0 failed, 10 skipped.
- Final focused reconciliation suite after adding the uncertainty test: 45 passed,
  0 failed, 0 skipped, including 20 native PostgreSQL tests.
- Typecheck, focused ESLint and server-boundary checks pass.
- Native integration POSTs real CSV fixture bytes, persists using the restricted
  role, GETs the result and validates dashboard context identity and duplicates.
  Existing native tests cover rollback, RLS, expiry/revocation, cross-tenant
  denial, immutability, concurrency, reconnect and uncertain commit behavior.
- Raw reports: outputs/db04-ai06/upload-dashboard.json and upload-final.json.
  Runs overlap; counts must not be summed. Full suite was not rerun; its prior
  failures remain disclosed. No automated browser rendering or live Next HTTP
  server test was executed; the end-to-end test invokes actual HTTP handlers.

No migration changed. C1/V2 adapters were not invented. AI02 fuzzy and AI03 E5
still require a separately versioned, tested cash-record feature projection:
role-qualified record IDs, exact decimal strings/direction, original date basis,
source SHA and original evidence must travel alongside ranking features.
Research cohort/template constraints cannot certify document ingestion. E5 ranking
must use an installed runtime and every proposal must still pass independent
verification; no frozen artifacts, research thresholds or model inference changed.

Docker/Supabase CLI remain unavailable. Hosted compatibility, migrations,
write/read and hosted security are not verified. Production, Vercel settings and
hosted authentication remain unchanged. PR #57 stays Draft and unmerged.
