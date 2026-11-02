# Live local application and proposal-ranking evidence

Starting commit: 2ff9f85496c5ee8c6dcd93693b6503249690f595.
No hosted database, Production auth, Vercel setting or frozen research artifact
was modified. No downloads or remote model calls were used.

## Actual application verification

The native PostgreSQL test now starts a real Next dev server (webpack), applies
the reviewed local prerequisites and DB04 migrations to a fresh native cluster,
provisions a restricted nonowner/nonbypass login and synthetic Finance sessions,
and exercises actual HTTP rather than calling route handlers directly:

1. POST both exact-byte synthetic documents with the Finance Bearer session.
2. Read an acknowledged processing ID and repeat POST to confirm reuse.
3. GET the same stored records and validate their processing/source context.
4. Deny another organization at the actual endpoint.
5. GET Transactions, Reconciliation, then Transactions again; all return the local
   persisted-financial workspace, without substituting the browser demo.

An actual Next integration defect was found and corrected: Next normalizes
loopback hostnames and injects forwarding headers even on a direct listener.
The guard now permits only loopback equivalents on the same port and matching
forwarded authority/origin. Remote or mismatched authorities remain disallowed.
Production/Vercel gates remain unchanged. Initial failed readiness attempts are
retained in the raw evidence directory; they are not counted as passes.

This is live HTTP and server-rendered page verification, **not browser automation**.
No click/file-picker screenshot test was performed. The test terminates its Next
process tree and removes only its own disposable cluster afterward.

## Exact local fixture registration and manual browser steps

FINGENCE_DB04_TEST_FIXTURES=1 selects hardcoded hashes of the two committed files
under tests/reconciliation-persistence/fixtures/. It throws unless NODE_ENV is
development, FINGENCE_DB04_LOCAL=1 and VERCEL is absent. Hashes cannot come from
request parameters or arbitrary environment values. Without the flag, the original
approved source registry is used unchanged.

For manual inspection on an already provisioned LOCAL database:
1. Apply the documented reviewed local prerequisites, db04-001, db04-002 and
   db04-003-ranking-evidence.sql. Use a separate restricted runtime login.
2. Configure its loopback-only SUPABASE_DATABASE_URL privately; retain existing
   TLS behavior. Provision an existing supported local M2/M3 Finance session.
3. Set FINGENCE_DB04_LOCAL=1 and FINGENCE_DB04_TEST_FIXTURES=1, leave VERCEL unset,
   then run pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3108.
4. Open http://127.0.0.1:3108/transactions, enter the session in the password
   field, select the committed BANK and LEDGER CSVs and choose Process documents.
5. Compare displayed processing ID/hashes and exact amount 6380.53; switch to
   Reconciliation and inspect the same context. Repeating upload must reuse it.
6. Refresh: the memory-only session/result clears; no demo result should appear.
   Authenticate/upload again to retrieve the durable context. Never store a
   session token in URLs or logs. The automated native suite supplies isolated
   provisioning itself; it does not leave a reusable session/server running.

Repeat the automated scenario with:
pnpm exec vitest run tests/reconciliation-persistence/native.postgres.test.ts

## Fuzzy and E5 integration

The versioned ranking adapter consumes authenticated persisted DB04 reads, not C1
or research cohort records. It checks role-qualified identity, source hash binding,
raw signed decimal agreement, currency and unchanged VALUE_DATE/POSTING_DATE.
It rejects duplicated record identities, incompatible basis and missing evidence.
Only equal signed amounts/currency and same canonical date enter ranking. This is
an explicit new same-day adapter policy, not a change to the frozen two-day policy.
At most 200 source records and 32 unique E5 texts are supported in this increment.

AI02 fuzzy/scoring and AI03 loader/worker/model-config/text-features were reused
from feature/ai-reconciliation-celester at 425b28b. Local structural interfaces
replace research cohort dependencies; original research files/evaluations remain
unchanged. Fuzzy weights and counterparty contradiction behavior are unchanged.
Scores use textual features only; exact money comparisons use existing BigInt
cashCents. Semantic text excludes IDs, labels, references and money fields.

Internal service methods rankFuzzy and rankE5 read authorized immutable inputs,
then reauthenticate before atomic evidence insertion. New db04-003 adds only the
rankings table with job/tenant/member FKs, forced RLS, actor binding, append-only
trigger and SELECT/INSERT runtime grants. Reprocessing returns the same versioned
evidence. GET returns stored ranking evidence when the additive table is installed;
older DB04 installations still return their deterministic context.

These are **proposal-only** ranking integrations: every fuzzy/E5 result remains
UNRESOLVED, ambiguity creates no assignments, and original deterministic decisions
are never rewritten. Financial eligibility checks are required before scoring;
full proposal-specific independent financial/identity approval and assignment
resolution remain future work. Ranking never posts or approves a transaction.
The dashboard continues to display deterministic decisions; ranking methods are
internal opt-in services, not automatically invoked by document upload.

The already installed ../ai03-runtime and pinned ../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78
were actually executed offline. The reused worker verifies library/model hashes,
384 dimensions and tokenizer settings before CPU inference. The adapter applies
the original cosine calculation and preserves real model metadata. E5 has a
bounded batch and 120-second deadline with worker cleanup; no fabricated vectors
or similarities were used in the executed inference tests.

## Executed counts and limitations

- Relevant regressions with actual E5 enabled: 600 passed, 0 failed, 10 skipped
  (outputs/db04-ai06/live-ai-final.json). Final ranking-read addition was then
  covered by the focused run below.
- Final focused run with DB04_E5_SMOKE=1: 54 passed, 0 failed, 0 skipped,
  including 23 native PostgreSQL tests (live-ai-release.json).
- One native test covers the real Next server; another executes and persists real
  E5 rankings. A separate real E5 smoke test checks vector dimensions/determinism.
- Typecheck, focused ESLint, server-boundary and whitespace checks pass.
- Runs overlap and must not be summed. Full project suite was not rerun; previous
  30 baseline-reproduced failures remain disclosed. Default runs explicitly skip
  real E5 tests unless DB04_E5_SMOKE=1; missing runtime is not represented as success.
- Docker/local Supabase and hosted Supabase remain unverified. Hosted identity,
  migration approvals and Production deployment remain separate dependencies.
