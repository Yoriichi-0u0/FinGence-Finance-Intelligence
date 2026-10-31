# Saturday financial-intelligence integration — Issue #38

This local synthetic PoC combines reviewed PR #42 (`083f673`) and all six original PR #41
commits (`b9890a8`) above the unchanged PR #35 fallback (`a07d615`). The two histories are
preserved by a local integration merge. This is a Draft stacked candidate, not a main merge
or hosted release. No hosted DB, provider dispatch, new dependency or accounting-policy change.

## Start

Use Node 24.22.0 and pnpm 11.19.0 in this checkout:

```sh
pnpm install --frozen-lockfile
FINGENCE_POC_PORT=3190 pnpm poc:dev
```

Open `http://localhost:3190/reconciliation`. The server binds only `127.0.0.1`. Use the
existing privately provisioned local Finance account. One server owns this checkout's
`.local/m2-database-v1`; do not open that database from a second process. Preserve the PR #35
worktree/database as the fallback. Do not copy a running database or share it across checkouts.

## Journey A — March source, about four minutes

1. On Reconciliation, select `demo_bank_statement_mar2026.csv` and
   `demo_general_ledger_mar2026.csv` from the supplied private pack, then process both.
2. Confirm 175 bank and 177 ledger observations. Inspect all seven outcome categories:
   151 exact; 6 date shift; 7 bank only; 6 ledger only; 4 amount review; 3 ambiguous ledger;
   4 reference review. Bank movement is MYR 102950.56, ledger 100434.50, difference 2516.06.
3. On Anomalies, upload the **same March bank bytes**. This is the existing source upload,
   not a second interpretation pipeline. Select BUS-001 / March 2026 / MYR.
4. Open Transactions: 175 source rows, 60 credits / 115 debits; credits 230966.35,
   debits -128015.79, net 102950.56. Search/filter/paginate actual source records.
5. Open Analytics: one observed month, 14 deterministic anomaly review candidates and the
   exact SHA-matched reconciliation. Inspect Anomalies and download its management PDF.
6. Open Forecasting: **unavailable — not enough history**, because this source has one month.
   No fabricated history, forecast, revenue or profit is displayed.

## Journey B — full source, about three minutes

1. On Anomalies, upload `source_transactions_6000.csv`; no labels/ground truth are uploaded.
2. In Transactions select this source, BUS-001 / March 2026 / MYR. The net remains 102950.56.
3. Analytics displays the twelve observed periods, September 2025 through August 2026.
   March has 9 anomaly candidates for this source population. The March-only reconciliation
   remains **unavailable**: the full source has a different uploaded SHA, even at equal totals.
4. Open Forecasting using the source-view link or sidebar. Source and business stay selected.
   The six-month average baseline for September 2026 is receipts 205774.83, payment magnitude
   129113.73, derived net 76661.10. All values come from source history, not AI.
5. Read the rolling-origin evaluation. Pooled WAPE: receipts 18.01%, payments 9.81%, net 52.85%.
   Net is worse than last-month WAPE 46.90%; do not present it as a reliable prediction.
6. Switch business/source and return to Analytics. Explicit source selection, source SHA,
   membership-scoped navigation preference and server authorization keep the views aligned.

## Integration controls

- Forecast history matches Analytics exactly; Forecasting shows debit **magnitudes**, while
  Analytics preserves signed negative debits. Both compute the same net.
- Forecast navigation preserves a previously observed selected month only for the same source,
  business and currency. Changed source/business uses an actual observed month, never invented.
- Selection stored in sessionStorage is a non-authoritative preference, scoped to current
  user/org/role/membership version. No credentials or financial payload are stored there.
- Invalid source hints fail closed instead of silently selecting another uploaded file.
- Forecast sign-out follows the existing explorer display fence. An undelivered logout hides
  current mounted results and reports uncertainty; it is not proof of durable server revocation
  across browser reload/navigation. No authentication redesign is included.
- Hosted/Production feature routes remain blocked. The combined checker has **63 probes**,
  preserving all insights and forecasting restrictions and both server boundary lists.
- `/data`, M3/Production fallbacks, reconciliation/anomaly rules, financial precision and
  experimental V2/C1 separation remain intact.

## Reproduce checks

```sh
FINGENCE_POC_DATASET_DIR=/path/to/private/poc-pack pnpm exec vitest run tests/poc-insights tests/poc-forecast tests/poc-anomalies tests/poc-reconciliation --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
node supabase/tests/verify-local.mjs
node supabase/tests/verify-upgraded.mjs
pnpm build
pnpm audit
```

The complete configured suite additionally uses the existing private original workbook,
Python/OCR environment and disposable native PostgreSQL harness. Unconfigured CI skips are
reported separately. Existing artifact-checker physical `.local` ancestry limitations are
handled by a source-hash-verified neutral build export, not by weakening isolation checks.
Actual commands, results, browser screenshots and audit findings belong in the review package.
