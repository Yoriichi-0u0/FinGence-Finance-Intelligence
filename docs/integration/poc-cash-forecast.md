# PoC cash-movement forecast — issue #37

Local, synthetic-only replacement of the mock Forecasting page, stacked on the combined PoC
(PR #35, `a07d615`). A deterministic, exact-cents baseline with measured rolling-origin
backtests. It is **not** AI, machine learning or a trained model, and **not** revenue, profit,
expense or a statutory cash flow statement. No Production activation, hosted migration, model
dispatch, Groq change or new dependency.

## What it computes

Input is the organization's existing Finance-uploaded source in `fingence_poc.anomaly_sources`
(uploaded on `/anomalies`), re-hashed against its recorded SHA-256 and parsed with the existing
feature-only `parseSource()`. Only business, currency, statement month, bank direction, amount and
signed amount are used; label, category and generation-metadata columns are never read.

Per business and month: **receipts** (sum of bank credits), **payments** (magnitude of bank debits)
and **net movement** (receipts − payments), in integer cents.

- **Next month** = mean of the previous six months, separately for receipts and payments,
  rounded half away from zero to the cent. Net = forecast receipts − forecast payments.
- **Backtest**: every month from the 7th onward is forecast only from earlier months by
  last month, 3-month mean and 6-month mean. WAPE = Σ|error| / Σ|observed|; MAE = mean |error|.
  Results are shown per business and pooled across the file's businesses of one currency.
- **Refusals** (no forecast, no backtest, history still shown where meaningful): fewer than
  7 consecutive months, any month gap (never filled), mixed currencies, a signed amount that
  does not equal ± amount for its direction, or stored bytes that no longer match their hash.
  No confidence intervals or model comparisons are produced.

Code: `lib/poc-forecast/forecast.ts` (pure), `lib/server/poc-forecast/{service,runtime}.ts`,
`app/api/ai-ingestion/m2/forecast/route.ts` (GET only), `components/poc-forecast/workspace.tsx`,
`app/forecasting/page.tsx`. When the PoC stack is off, `/forecasting` renders the unchanged
illustrative page (`app/forecasting/illustrative.tsx`).

## Measured on `source_transactions_6000.csv`

SHA-256 `c0bf6efd9ee00ef9bd135107463e151bd51b4293dc86bdaf768d68e83c0f44dd`; 3 businesses ×
12 consecutive months, Sep 2025 – Aug 2026, MYR. Pooled over 18 tests (6 per business):

| Metric | Last month | 3-month mean | 6-month mean |
| --- | ---: | ---: | ---: |
| Receipts WAPE | 23.82% | 20.31% | **18.01%** |
| Payments WAPE | 15.33% | 9.89% | **9.81%** |
| Net movement WAPE | **46.90%** | 51.81% | 52.85% |

For net movement the six-month mean is **worse** than last month; net is labelled experimental
and low confidence. Pooled figures are dominated by BUS-002, the largest business; the page
shows per-business WAPE and MAE too. Six tests per business is far too little evidence to claim
the method generalizes.

BUS-001 September 2026 (from March–August 2026): receipts MYR 205,774.83, payments
MYR 129,113.73, net MYR 76,661.10. BUS-003's derived net is negative (MYR −3,394.31).

These equal an independent standard-library Python recomputation from the same CSV and the
figures published in issue #37. `tests/poc-forecast/reference.test.ts` asserts them when the
private dataset is present locally (it is skipped otherwise and never committed).

## Demonstration

1. `pnpm poc:dev`, open `http://127.0.0.1:3186/anomalies` as an active **Finance** member and
   upload `source_transactions_6000.csv` (and, optionally, `demo_bank_statement_mar2026.csv`).
2. Open `/forecasting`, choose the 6,000-row source and a business. Read the source hash,
   history interval, 12-month chart and table, next-month cards and backtest tables.
3. Choose the March-only bank statement: the page states *Forecast unavailable: Not enough
   history* and shows one month of totals only.

Technical and Admin members see an explicit Finance-only denial; the API returns a generic 404
and the denial is audited. Every read is audited as `financial_record.read`. Figures are cleared
on sign-out, session revocation or any user/organization/role/membership-version change.
