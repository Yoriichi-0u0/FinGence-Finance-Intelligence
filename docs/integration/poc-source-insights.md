# Uploaded-source Transactions and Analytics — issue #36

Stacked on PoC PR #35 (`a07d615`), not a hosted release. The source explorer consumes the
existing `fingence_poc.anomaly_sources` bytes; it introduces no database, migration, provider,
authentication system or replacement upload format. Forecasting files are outside this change.

## Run

Use Node 24.22.0 and pnpm 11.19.0 in this checkout:

```sh
pnpm install --frozen-lockfile
FINGENCE_POC_PORT=3188 pnpm poc:dev
```

Open `http://localhost:3188/transactions`. Using localhost for this isolated worktree keeps
its host-scoped session cookie separate from the fallback demo at 127.0.0.1:3186. The server
still binds **127.0.0.1**. Default `pnpm poc:dev` remains port 3186. Never run two processes
against the same worktree PGlite directory. Local account provisioning uses the existing M3/M5
instructions; no credentials are committed. Use an active **Finance** member.

Upload the supplied bank statement or normalized full source through the existing Anomalies
page. Transactions/Analytics then select the already-stored source. The source selector shows
file name, original row count and SHA-256, not a seeded financial dashboard. Reconciliation
must already exist for the exact bank bytes before its snapshot can appear in Analytics.

## Working capabilities

- Search source ID, reference, description or counterparty; filter bank direction, date range,
  absolute amount and currency. Deterministic date/ID order and bounded pagination.
- Selected-month credit/debit/net totals remain separate from filtered table totals. Values
  use integer cents and exact decimal strings, never floating-point financial arithmetic.
- Analytics plots only months actually in the uploaded file, for one business and currency.
  The March-only bank file has one point; the supplied full source has twelve periods.
  Exact source values accompany the reused chart; no history, forecast or accounting meaning
  is invented. Chart ratios are presentation only.
- Existing anomaly rules are reused unchanged. March bank-only population: 14 candidates;
  March selected from the full source: 9. These are deterministic review candidates, not fraud
  conclusions, trained-model predictions or actual live inference.
- Reconciliation requires the same organization/business/month/currency AND uploaded bank SHA.
  Full-file March selection remains unavailable even when its net equals the March bank net.
- Navigation between Transactions, Analytics, Anomalies and management-report links preserves
  selected source/business/month/currency through URLs and an access-scoped sessionStorage
  preference. That preference contains no credentials, financial payload or authority. It is
  keyed by user/org/role/membership version and discarded when access is invalidated.
- Session polling, response epochs and request sequence fencing clear financial results on
  logout/revocation and prevent late responses restoring old scope. Explicit sign-out pauses
  restoration until a successful fresh sign-in; a lost/failed logout response shows an
  unconfirmed notice and never silently re-adopts the old cookie. Server revocation cannot
  be claimed when the request did not arrive; the local pause is not a durable logout grant
  across reloads. Missing/invalid selection
  displays unavailable and can recover by choosing an authorized uploaded source.

## Financial policy / provenance

March BUS-001 / MYR has 175 source observations, 60 Credit and 115 Debit:
credits **230966.35**, debits **-128015.79**, net **102950.56**. Credit/debit sums preserve the
source's SignedCashMovementMYR; neither is labeled revenue/expenses/profit. All fields are
source observations, never cast to C1 or financially publication-eligible V2 records.
Source SHA, original row ID, original source-transaction ID (where present), date, reference,
counterparty and logical CSV record number are retained. Logical record counts include the
header; they are not physical text-line offsets. No evaluator labels are read by runtime code.

## Read-only interface / ownership

`GET /api/ai-ingestion/m2/insights?action=sources` lists only the current Finance organization's
uploads. `GET /api/ai-ingestion/m2/insights?source=<uuid>&business=BUS-001&period=2026-03&currency=MYR`
returns `poc-financial-insights-v1`, `publicationEligible:false`, current verified access scope,
source metadata, selection, options/periods, exact month totals, filtered totals, paginated
transactions, monthly series, anomaly counts and source-bound reconciliation.

Optional filters: `search`, `direction=Credit|Debit`, `from`, `to`, `minAmount`, `maxAmount`,
`page` (1..20000), `pageSize` (1..100). Dates are real ISO dates, amounts are unsigned exact
2-decimal strings; invalid ranges, duplicate query keys and extra authority fields are refused.
There are **no write actions**. POST always denies. Runtime requires existing PoC development
flags and loopback request validation; Production/hosted paths deny before database access.

Reusable series contract for later forecasting integration is the typed `series` property of
`PocInsights` (`lib/server/poc-insights/service.ts`): sorted observed periods with rows,
creditRows/debitRows and credits/debits/net exact strings, bound by returned source SHA and
selected business/currency. There is no forecast endpoint or implicit publication permission.

Every read resolves the existing live session, active membership and organization in the same
transaction, locks the source for reading, checks stored content SHA/layout/row count, computes
source projections and durably audits before delivering results. Role/tenant denial is generic;
query/audit failures never become successful empty financial data. Technical (Management) and
Admin do not inherit Finance record access. New bridge tests use PGlite; native PostgreSQL
coverage of older services must not be represented as new reader concurrency proof.

The M3 verified-batch UI remains when PoC is off. Hosted illustrative fallbacks and `/data`
are unchanged. Production isolation now includes 60 probes and checks for leaked new views.

## Verify

```sh
pnpm exec vitest run tests/poc-insights tests/poc-anomalies tests/poc-reconciliation --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm build
pnpm audit
```

Set `FINGENCE_POC_DATASET_DIR` to the private supplied pack for actual dataset tests. The full
configured suite additionally needs the existing Python/OCR environment and workbook path.
Run the production-isolation checker against a local production build. Its existing physical
`.local` ancestor limitation remains; source-identical neutral verification exports are used
without weakening checks. Actual commands, browser screenshots and outcomes accompany the
independent-review package; do not infer a test passed from this command list.
