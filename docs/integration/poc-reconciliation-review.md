# Finance exception review — Issue #45

Local synthetic PoC, stacked on PR #43 at `dca0534af77166a051be84e18af1977c680de2d0`.
Human annotations are separate from the immutable `FinancePoCReconciliationV1` snapshot.
They never clear a posting, select a ledger candidate, alter source amounts or create an
accepted C1/V2 record. No matcher, normalization, source hash or original JSON change.

## Three-minute demonstration

Use Node 24.22.0 / pnpm 11.19.0, the existing privately provisioned local Finance account,
and a single process owning this checkout's disposable PGlite database:

```sh
pnpm install --frozen-lockfile
FINGENCE_POC_PORT=3192 pnpm poc:dev
```

Open `http://127.0.0.1:3192/reconciliation`; reload once if the existing same-origin gate
refuses the initial direct navigation. The launcher binds only 127.0.0.1. The separate PR #43
fallback uses localhost:3190, keeping browser host cookies and database directories separate.
Do not start a second process against the same database. No hosted database is involved.

1. Select and process the supplied March bank and ledger CSVs (or choose their saved pair).
   Verify 175 bank / 177 ledger observations, original counts 151/6/7/6/4/3/4 and difference
   MYR 2516.06 (bank 102950.56 minus ledger 100434.50).
2. Select **Amount review**, then **Inspect source**. Inspect the bank/ledger evidence.
   In Human exception review, choose **Explained**, enter a source-grounded explanation and save.
   The original amount mismatch remains an amount mismatch.
3. Select **Duplicate ambiguity**, inspect one outcome and choose **Escalated** with an explanation.
   Neither ledger candidate is selected or cleared.
4. Refresh the page or sign out/in, select each exception again and read its saved decision,
   reviewer, timestamp and history. The original 181 outcomes and MYR 2516.06 remain unchanged.
5. Optional two-tab check: load the same Open exception in two tabs, save in one, then submit
   from the older tab. It must refuse the stale version and require **Reload review details**.

Only the five unmatched/review statuses are eligible: BANK_ONLY, LEDGER_ONLY,
AMOUNT_MISMATCH_REVIEW, AMBIGUOUS_DUPLICATE_LEDGER and REFERENCE_MISMATCH_REVIEW.
March therefore has **24 original exceptions**; exact/date-shift matches stay read-only.
After one Explained and one Escalated decision, separate reviewer totals are Open 22,
Investigating 0, Explained 1 and Escalated 1. Matcher counts do not decrease.

## Versioned contracts

`lib/poc-reconciliation/reviews.ts` defines the four review states, strict write schema,
revision history, `ReconciliationReviewView` and `ReconciliationReviewAggregateV1`.
An unannotated eligible outcome has explicit Open/version 0 metadata. Non-Open decisions
require a trimmed explanation, maximum 600 characters. No MATCHED/RECONCILED state exists.

`GET /api/ai-ingestion/m2/reconciliation/reviews?id=<saved UUID>` returns the authorized
view, separate state totals, stable outcome keys and current/history revisions. The write
`POST` accepts **only** reconciliationId, the server-returned outcomeKey, state, rationale and
expectedVersion. It rejects browser identity, organization, source hashes and amount claims.
Stale authorized edits return 409. Other denied/unavailable requests use a generic 404.
Both methods require the existing local PoC gate; writes require same-origin JSON input.

The server computes each key as SHA-256 of the saved bank/ledger hashes, original matcher
status, bank record ID and sorted ledger IDs. Index/filenames are not authority. Every write
checks eligibility against the persisted snapshot and uses the current Finance session,
active membership and organization. The snapshot's source hashes must match its parent row.

## Persistence and audit

The additive `fingence_poc.reconciliation_reviews` table stores **append-only application
revisions**, keyed by organization, reconciliation, outcome and version. Each revision stores
the decision, explanation, server reviewer and timestamp. Existing rows are not overwritten.
RLS is enabled and anon/authenticated direct table access is revoked. This remains the existing
server-controlled local PoC database architecture, not hosted RLS/Production activation.

The saved reconciliation parent row is locked for writes before the version check, including
the first annotation, preventing an absent-row insert race. Annotation and the content-free
`reconciliation.reviewed` audit event commit in one transaction. Audit failure rolls back the
annotation and blocks success. Explanations/financial payloads never enter audit events.
Lost/undecodable responses require explicit retrieval before another submission; no automatic
write retry exists. Expected versions prevent the same stale submission being applied twice.

## Read-only compatibility for future report/Q&A composition

`readReconciliationReviewAggregate(tx, principal, reconciliationId)` in
`lib/server/poc-reconciliation/reviews.ts` returns `poc-reconciliation-review-aggregate-v1`,
source-pair identity, original org/business/period/currency scope, eligible count and reviewer
state totals. It operates inside the caller's existing authorized/audited transaction and
rechecks Finance/organization/parent ownership. The caller must bind the returned saved pair,
both hashes and full scope to its source; never attach by month or equal totals alone.
These totals count annotations, not reconciled transactions. No report/Q&A consumer or Claude
file is changed in this increment. Original reconciliation JSON remains the original contract.

## Verification and limitations

```sh
FINGENCE_POC_DATASET_DIR=/path/to/supplied-pack pnpm exec vitest run tests/poc-reconciliation tests/poc-insights tests/poc-forecast tests/poc-anomalies --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm build
pnpm audit
```

Tests cover cross-role/tenant denial, revoked credentials, invalid keys/source claims,
missing explanation, stale repeat writes, immutable JSON, audit rollback, another active
Finance member's session, history, direct-role denial and actual March source figures.
New integration tests use PGlite; no new native PostgreSQL concurrency guarantee is claimed.
Production isolation adds two review API probes, **65 total**. No hosted migration, new
credentials, model dispatch, correction/supersession or financial-policy change is enabled.
