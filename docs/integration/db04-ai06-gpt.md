# DB04 / AI06 GPT OSS proposal integration — 12 November 2026

Branch: `feature/ai06-gpt-integration-celester`
Base: `feature/db04-ai06-supabase-celester` at `901109b9057bfeb927367955bdc69d2e346a09e4`.

## Design proposed before editing

Add an optional server-only `createReconciliationBackend().proposeGPT(accessToken, processingId, provider)` method. Reuse hosted Finance admission and the existing scoped DB04 reader. Require persisted BANK/LEDGER sources to match the caller's trusted synthetic registry and DB04 classification. Reuse the existing conservative same-day cash candidate builder; do not expand the current financial policy. Supply only bounded, allowlisted source data and eligible IDs to GPT OSS. Parse the experiment's strict suggestion/abstention JSON and run DB04's independent verifier against freshly read authoritative records. Keep every outcome UNRESOLVED and leave existing process/get, routes, E5, migrations and research evidence intact.

## Inspection and implementation

Reviewed backend composition, service authorization, processing, trusted CashSource adaptation, fuzzy/E5 ranking, independent proposal verification and migrations 003/004. The local experiment's `src/prompt.ts`, `src/schema.ts`, `src/verify.ts` and `src/groq-provider.ts` supplied the proposal contract and provider boundary. Its verifier requires frozen research cohorts and therefore cannot certify DB04 records.

- `lib/server/reconciliation/gpt.ts`: registered-source gate, bounded candidate/context projection, authorization before and after inference, context-change rejection, fingerprints, abstention ID validation and independent verification. Checks copied references and all eligible alternatives, including alternatives omitted by GPT. Existing persisted rankings participate in conflict detection. No writes to financial tables or GPT evidence tables.
- `gpt-schema.ts`: experiment's strict bounded JSON parser, duplicate JSON-key/assignment checks and abstention consistency.
- `gpt-prompt.ts`: experiment's untrusted-data/abstention prompt, with date language bound to supplied DB04 policy rather than hard-coded research two-day permission.
- `gpt-provider.ts`: experiment's Groq GPT OSS 120B adapter, adapted imports and server-only guard. Explicit mode/approval configuration, one request, no retries/fallback, fixed endpoint/model, bounded request/response, deadline and sanitized errors. No constructor is called by default application routes.
- `backend.ts`: additive opt-in method using existing Finance admission. No HTTP endpoint or environment-based automatic activation.
- `proposal-verification.ts`: recognizes the distinct GPT proposal version; financial, lineage, identity, conflict and unresolved-only rules remain in force. GPT scores are never model confidence: candidate score/lineage derives from the existing server-side candidate builder.
- `tests/reconciliation-persistence/gpt.test.ts`: 11 offline tests including mocked Groq success/429 transport. No real provider traffic.

The GPT method is local-only (denies production and Vercel). The provider dependency is trusted server code; arbitrary browser provider objects are not an input contract. Provider flags remain separately authorized operational configuration, not authorization inferred from an upload. No database migration or external execution is part of this implementation.

## Immutable evidence migration decision

An additive migration is required before durable GPT execution history can be offered. `db04-003` explicitly restricts ranking versions to fuzzy/E5 and has only one immutable row per algorithm/job. `db04-004` stores verification arrays, not complete provider requests, responses, abstentions or failures. Do not shoehorn GPT evidence into either table or edit historical migrations.

Proposed separately reviewed table: `gpt_runs`, keyed by organization/processing/run ID, with actor membership and job foreign keys; source hashes, prompt/schema/model revisions, request/source/proposal fingerprints, bounded allowlisted request/proposal/provider receipt, verification policy/results, abstentions, execution/failure state and timestamps. It must support append-only attempts including dispatch uncertainty, enforce tenant RLS and actor binding, use the existing immutable trigger, revoke PUBLIC access and restrict runtime privileges to SELECT/INSERT. A later execution design must durably reserve each attempt before dispatch to prevent retries after uncertain failures; current in-memory single-use provider objects do not provide cross-process replay protection.

No SQL migration was authored or applied. Current return explicitly says `NOT_PERSISTED_MIGRATION_REQUIRED`; it is review evidence, not an immutable database receipt. GPT results are not automatically displayed in the current UI or included in subsequent `get()` calls.

## Verification

Using installed local binaries (no dependency install):

- `node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/gpt.test.ts tests/reconciliation-persistence/ranking.test.ts tests/reconciliation-persistence/proposal-verification.test.ts tests/reconciliation-persistence/trusted-ingestion.test.ts tests/reconciliation-persistence/processing.test.ts --maxWorkers=1`: **5 files / 58 tests passed**, including **11 GPT tests**. TEMP/TMP pointed to ignored `.local/gpt-test-tmp` to avoid Windows sandbox rename failures. No database migration executed by this selected suite.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- Targeted ESLint on seven changed TypeScript files: passed.
- `node scripts/verify-server-boundary.mjs`: passed.
- `git diff --check`: passed.

Initial pnpm commands could not resolve the pinned pnpm version because the launcher attempted registry access and DNS failed; no dependencies were installed. An initial direct broad reconciliation-suite attempt failed before test collection with sandbox TEMP rename EPERM. The selected offline suite passed after using workspace TEMP. No full application build, native database tests or hosted tests were run.

## Remaining approvals / blockers

Durable immutable evidence storage, cross-process dispatch reservation, any migration execution, live Groq request and any hosted enablement require separate approval. No push, merge, deployment, Supabase settings changes or credential reads were performed. Existing AI01–AI05 source/evidence and migration files are unchanged.
