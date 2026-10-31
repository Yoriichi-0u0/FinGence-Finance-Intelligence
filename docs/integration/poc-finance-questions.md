# PoC Finance questions — issue #46

A local, synthetic-only **rule-based source assistant** at `/finance-questions`, stacked on the
combined Saturday PoC (Draft PR #43, `dca0534`). It answers fixed financial questions about
the selected, Finance-authorized uploaded source with figures that the server computes. It is
**not** live AI: no language model, Groq, Ollama or other provider is called. Unsupported
questions are refused instead of answered with invented figures. There is no Production
activation, hosted change, new dependency or change to any financial calculation.

## How an answer is made

1. The browser sends only a source id, optional business/month/currency and the question text
   (`POST /api/ai-ingestion/m2/finance-questions?action=ask`, same-origin JSON, ≤ 2 KiB, exact
   key allowlist). Organization, role, user and figures never come from the browser.
2. Inside one Finance-authorized transaction the server re-reads the organization's uploaded
   bytes from `fingence_poc.anomaly_sources`, re-hashes them against the recorded SHA-256 and
   recomputes facts with the **existing** functions:
   - `projectSource` and `cashTotals` (Transactions/Analytics): selection, records, credits,
     debits, net signed movement and observed monthly series;
   - `detectAnomalies` plus stored review states (Anomalies): candidates and rule categories;
   - `readScopedReconciliation` + `readReconciliation` (Reconciliation/report): only the
     snapshot bound to the same organization, business, month, currency and **bank SHA-256**,
     and only when exactly one ledger pair exists;
   - `forecastBusiness` and `poolBacktests` (Forecasting): the six-month baseline and backtests.
3. `lib/poc-finance-qa/answer.ts` routes the wording with a fixed, ordered keyword table to one
   intent and copies the computed figures into the answer. Each read is audited as
   `financial_record.read`; a non-Finance caller gets a committed `authorization.denied`.

Every answer carries `answerOrigin: 'DETERMINISTIC_VERIFIED_SOURCE'`, `liveModel: false`, the
source id, file name, SHA-256, business, month and currency, a 1–3 sentence interpretation,
the quoted facts, record id groups where relevant and evidence links to the existing
Transactions, Anomalies, management report, Reconciliation and Forecasting views.

## Supported intents

| Intent | Example | Source |
| --- | --- | --- |
| Records and totals | How many source records, credits and debits are there? | selected month |
| Cash movement | How much cash movement was recorded? | selected month, signed bank amounts |
| Bank − ledger difference | What is the bank-versus-ledger difference? | SHA-bound snapshot |
| Matches | How many transactions were matched? | SHA-bound snapshot, 7 categories |
| Records to review | Which transactions require review? | non-match outcomes + open anomaly candidates |
| Anomaly candidates | How many anomalies were identified? | candidates / rows in selected month, rule counts |
| Monthly history | How many months of history are observed? | observed months, business + currency |
| Cash baseline | What is the next-month cash-movement forecast? | ≥ 7 consecutive months only |

## Refusals and unavailability

- **Refused**, no figures: profit, revenue, income, expenses, margins, ratios, tax, valuation and
  other accounting metrics; advice, investment, lending and fraud or wrongdoing questions;
  "why"/cause questions; unknown questions; a question naming a different business, currency or
  month than the selection (questions never change the selection).
- **Unavailable**, no figures: a reconciliation that is not bound to this exact uploaded bank
  SHA (the full 6,000-row file never inherits the March pair, even with equal March totals);
  a forecast with fewer than 7 consecutive months; a named month absent from the source.
- Answers are cleared on sign-out, session revocation, any user/organization/role/membership
  version change and any source/business/month/currency change. Technical and Admin members
  see an explicit Finance-only denial; every API returns a generic 404 to them.

## Future language layer (not wired)

`lib/poc-finance-qa/narration.ts` defines the only contract a future, separately authorized
model could use: it may paraphrase an *answered* result, must cite existing fact ids, and any
number in its text must equal a cited fact exactly (`acceptNarration`). Refusals are never
narrated. The only implementation is `templateNarrator`, which returns the deterministic text.
Nothing imports a provider and nothing dispatches a request.

## Demonstration (about three minutes)

1. `pnpm poc:dev`; sign in as an active Finance member.
2. Reconciliation: process `demo_bank_statement_mar2026.csv` and `demo_general_ledger_mar2026.csv`.
   Anomalies: upload the same March bank file.
3. Finance questions (sidebar): click the suggested chips. Expected for BUS-001 · 2026-03:
   difference MYR 2,516.06 (bank 102,950.56, ledger 100,434.50); 157 of 175 bank records matched
   (151 exact, 6 date shift); 24 reconciliation outcomes and 14 open anomaly candidates to
   review; net movement MYR 102,950.56; 14 of 175 anomaly candidates; forecast **unavailable**;
   "What is net profit?" **refused**. Open an evidence link to show the source view.
4. Anomalies: upload `source_transactions_6000.csv`. Back on Finance questions choose that
   source, BUS-001, 2026-03 (answers clear on switch): 12 consecutive months (2025-09 to 2026-08);
   September 2026 baseline receipts MYR 205,774.83, payments 129,113.73, derived net 76,661.10,
   with the backtest caveat (pooled net WAPE 52.85% vs 46.90% for last month); net movement
   102,950.56; 9 anomaly candidates; reconciliation **unavailable** for this different SHA.

`tests/poc-finance-qa/reference.test.ts` asserts these figures when the private dataset is
present locally (skipped otherwise; no dataset is committed).

## Limitations

- Intent routing is a fixed keyword table. Paraphrases outside it are refused, and an unusual
  wording can route to a neighbouring intent; the answer always states which question it answered.
- Answers cover one selected business, month and currency; there is no cross-business or
  cross-source comparison.
- The "records to review" list can contain the same row twice (reconciliation outcome and
  anomaly candidate); both are shown separately and no cause is inferred.
- The forecast keeps every limitation of the issue #37 baseline: few backtest months, pooled
  figures dominated by the largest business, and an unreliable net.
- In a production build `/finance-questions` and its API return 404.
