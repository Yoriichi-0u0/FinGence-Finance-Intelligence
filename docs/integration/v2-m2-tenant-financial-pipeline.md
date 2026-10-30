# V2 M2: tenant-owned local financial workflow

This branch implements Issue #22 on PR #21's reviewed source. It is not a hosted release.
`/data`, stable C1/C2 and P2 calculations are unchanged. No V2 records are cast into C1.

## Run locally

Use Node 24.22.0, pnpm 11.19.0 and the existing Python/OCR environment documented in
[workspace setup](../ai-ingestion/workspace.md). No dependency upgrades were required.

```sh
pnpm install --frozen-lockfile
# Stop m2:dev before provisioning; only one process may open the local PGlite directory.
# Set M2_LOCAL_EMAIL, M2_LOCAL_PASSWORD (12–128 characters), M2_LOCAL_ORGANIZATION
# privately in your terminal. Do not paste credentials into chat or commit them.
pnpm m2:account
# Unset those three provisioning variables after use.
pnpm m2:dev
```

Open **http://127.0.0.1:3182/ai-ingestion**. The launcher binds to loopback and enables
only local capabilities. A separate password-hashed account and organization are created
by the OS-local provisioning command. There is no shared-code or fallback identity.
Passwords use salted scrypt; only session-token hashes enter the database. Cookies are
HttpOnly, SameSite=Strict and restricted to the M2 API path; HTTP is intentional on loopback.
Sessions expire after 30 minutes. Every financial operation checks the current active,
version-bound membership. Finance may process/read its organization. Technical (Management)
and Admin do not inherit financial access. User/role administration is not implemented.
Multiple active organizations fail closed until a reviewed organization-selector exists.

The persistent disposable database lives in `.local/m2-database-v1`, not hosted Supabase.
Keep it private. The account CLI refuses hosted/Production execution. Never run two M2
servers against one directory. Server restarts preserve accounts, jobs and committed batches.

## Connected processing

1. Sign in, select a registered synthetic document, and click **Process document**.
2. The server reserves the operation identity before upload. The browser retains it in
   per-tab, user-and-organization-scoped sessionStorage before dispatch; reload recovery does not create another identity. Active user, organization, role or membership-version changes invalidate cached financial state and outstanding replies. Older unscoped references migrate only after a durable audited server ownership lookup; another account cannot claim or erase them.
3. `extractTrustedEvidence()` performs real CSV/XLSX/PDF/image extraction.
4. `offlineSemanticAdapter` dynamically proposes mappings from source evidence and the
   existing terminology registry. It is explicitly **SIMULATED**, not genuine inference,
   recorded model accuracy or an authorized accounting policy. It never reads gold labels.
5. Existing `materializePlan()` and the unchanged independent verifier enforce source
   binding, conventions and coverage. Unsupported fields/conventions abstain automatically.
6. Existing sealed `VerifiedDocumentBatchV1` persistence runs in a transaction that also
   establishes organization ownership, completes the job and durably acknowledges audit.
7. Authorized retrieval supplies the same persisted records to calculations, on-screen
   results, sourced JSON download and the deterministic question tool.

Use `synthetic/m2/verified-mixed.csv`: four observed rows, three verified (two VALID, one
WARNING), one rejected invalid date; exact MYR **105.5** excluding warnings, **85.5** including
warnings. Duplicate source rows remain warning records, not silently deleted.
`synthetic/m2/quarantine.csv` has an unsupported field: zero verified, one unresolved.
The files are new authored test controls, not independent model evaluation. Their
SHA-256 manifest limits this local route to approved synthetic bytes. Existing registered
Increment 01–03/I2 CSV, XLSX, digital/scanned PDF, PNG and JPEG controls are also supported.
Extraction success does not guarantee financial acceptance.

## Contracts and safety

- `m2/identity.ts`: `createM2Identity`, `resolveM2Principal`, `provisionM2Account`.
- `m2/interpreter.ts`: `M2Interpreter`, `offlineSemanticAdapter`, `groqReadyBoundary`.
- `m2/pipeline.ts`: `createM2Pipeline` (`reserve`, `process`, `list`, `get`, `investigate`,
  `cancel`), `calculateM2Batch`, `installM2Schema`.
- Existing V2-I1 sealed batch version: `verified-document-batch-v1`.
- Report: `m2-financial-report-v1`, `publicationEligible: false`, exact decimal strings,
  currency/basis-separated groups, selected source evidence, conventions and quarantine.
- New local schema: `supabase/sql/v2-m2-local.sql`. Additive; C1/P2 tables are unchanged.

Accepted VALID/WARNING, REJECTED and UNRESOLVED records remain distinct. Document-level
quarantine never counts as a row. Unknown coverage or failed document checks cannot
produce a total. Only supported source-signed amounts with source currency may be summed;
debit/credit ledger amounts are not treated as bank direction, revenue or cash flow.
The warning policy and citations agree across display, JSON and deterministic answers.
No reconciliation, forecasting or model-backed chatbot is claimed.

Attempt identities are claimed once. Duplicate submissions cannot persist twice.
Confirmed pre-commit failures remain failed; uncertain/unclassified persistence failures
remain blocked. A committed operation is retrievable after response loss and restart.
Explicit investigation uses the existing V2-I1 primary-database transaction fence.
A process killed before completing a PROCESSING operation remains blocked for investigation;
there is no durable scheduler, heartbeat/reaper or automatic retry. Only unstarted RESERVED
operations can be cancelled. Reprocessing is a new explicit operation after a known outcome.

The API denies every hosted/Production invocation, even with local flags. POST requires
an exact loopback Origin. It accepts file bytes, not user/tenant IDs or verification JSON.
Data API roles have no schema/table grants; RLS is enabled. The local server connection
owns its schema and application authorization is essential; this is not evidence of a
restricted Production database role or deployed RLS design. Audited reads hold session,
membership and ownership locks until the audit transaction commits. Native tests distinguish
that guarantee from PGlite verification. Failed audits withhold results.

`groqReadyBoundary` accepts only separately authorized server-side provider injection and
valid LIVE_GROQ receipts through the existing quota-controlled provider. M2 runtime does
not construct it, read a key, or offer a browser/environment switch to enable live dispatch.
Fresh secure provider setup and durable one-shot dispatch authorization remain prerequisites.

## Team integration boundaries

- Chia (#5/#22): V2 extraction/orchestration, independent verification and full-stack contract.
- Celester (#6): reuse V2 sealed persistence and future restricted tenant-owned adapters.
  This schema is local only; no hosted migration or C1 conversion is authorized.
- Jason (#8): real local sessions/membership and audit foundation; future hosted identity,
  account lifecycle and Administration UI remain separate reviewed work.
- Frederick (#7): reusable exact-decimal arithmetic only; consume explicit currency/basis
  and warning policy. No unsupported economic classification.
- Izzat (#9): connected `/ai-ingestion` results and JSON export. Global illustrative pages
  are not connected to M2 data; use the M2 workspace for current results.

## Verify

```sh
pnpm test tests/ai-ingestion-m2 --maxWorkers=1
# Configure FINGENCE_AI_PYTHON and PATH to the existing Python/OCR environment.
# Native tests use existing local PostgreSQL binaries; FINGENCE_TEST_PG_BIN can override.
pnpm test --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
node supabase/tests/verify-local.mjs
node supabase/tests/verify-upgraded.mjs
node tests/persistence/schema-compatibility.mjs
pnpm build
# Against a local next start production server; never against hosted infrastructure:
node scripts/verify-ai-production-isolation.mjs http://127.0.0.1:3118
pnpm audit --json
```

Browser acceptance: desktop 1440×900, mobile 390×844 and 320px; upload both controls,
switch batches, change warning policy, download JSON, ask a supported/unsupported question,
reload a committed batch, sign out in another tab and confirm results disappear. Do not
substitute HTTP tests for browser evidence. Private accounts, local data, cookies and
provider state must not enter Git, deployment artifacts or review ZIPs.
