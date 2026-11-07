# Several months and any currency, end to end; autonomous anomaly resolution (v1)

5 November 2026, checkpoint 9 of the roadmap (#78).

## What changed

The `/data` pipeline (`lib/demo/pipeline.ts`) used to read one month in MYR. It now passes the ingestion scope and the reconciliation scope through every stage:

- **Ingestion:**
  - `ingestDocuments` uses `INGESTION_SCOPE`.
  - Both normalizers use `RECONCILIATION_SCOPE`.
  - An AI-read or supported-schema document may cover several months and state any ISO currency.
- **Scope:**
  - `scope.period` is one month (`YYYY-MM`) or the bank statement's range (`YYYY-MM/YYYY-MM`), and `scope.months` lists every statement month.
  - The bank and the ledger must share the business and the currency, and have at least one month in common.
  - One currency per processing, with no conversion. The conventions state the currency.
- **History:** every statement month must appear in the history with exactly the statement's records and net. Otherwise the history is quarantined; reconciliation is not blocked.
- **Reconciliation:** every month both documents cover is reconciled by the layer ([reconciliation layer v1](reconciliation-layer-v1.md)).
  - `outputs.periods[]` holds each month's matcher snapshot and statement.
  - `outputs.reconciliation` is the whole run's snapshot: a one-month run's own snapshot, or every month's results combined. It passes the same contract (`readReconciliation` accepts the range).
  - `outputs.notReconciled` lists the months only one document covers. They are reported, never matched against nothing.
- **Analytics:** totals cover every verified bank record. The consistency check explains any part that falls in months without a ledger. The monthly trend uses the statement's own months when there is no accepted history.
- **Forecast:** unchanged. It forecasts from the accepted history, or from the statement when the statement alone covers enough months.
- **Q&A:**
  - The grounded catalogue accepts the range. `cash_summary` answers for any single month, or for the whole range.
  - The month-name gate accepts every month the run covers.
  - The rule-based answerer refuses a question naming one month of a multi-month run, because its totals cover the whole run and are never split by guessing.

## Autonomous anomaly resolution

`lib/anomalies/resolve.ts` `resolveAnomalies(candidates, layer)` gives every anomaly candidate exactly one resolution:

| Resolution | Rule |
| --- | --- |
| `CORROBORATED_BY_BOOKS` | The reconciliation shows the same bank record in the cash-account ledger with the same signed amount: matched, matched late, matched by amount, or cleared as a timing difference in another month. The business has recorded the transaction, so no action is needed. |
| `FLAGGED` | The books do not record it, no ledger covers its month, or the bank record contradicts itself (direction conflict). It is flagged to the technical team, not to Finance. |

- Only `FLAGGED` candidates enter `quarantine`.
- The run is `COMPLETED` when nothing is flagged.
- The detector's rules and thresholds are unchanged. A finding is still a reason to look, never a fraud conclusion.

## Samples

| Sample | Business | Months | Currency | Outcome |
| --- | --- | --- | --- | --- |
| `public/demo/` (`scripts/generate-demo-documents.mjs`) | DEMO-001 | 2026-03 | MYR | Figures as before. All 6 anomaly candidates are confirmed by the books, so the run is `COMPLETED` with nothing flagged. |
| `public/demo/quarter/` (`scripts/generate-quarter-documents.mjs`) | DEMO-002 | 2026-01 to 2026-03 | SGD | See below. |

The quarter sample:
- **Reconciliation:** 3 months reconciled and 104 transactions matched. Timing differences clear across months: a January deposit reaches the bank in February, and a February cheque and a late booking clear in March. One deposit is still in transit at the end of March. 4 correcting entries are prepared.
- **Anomalies:** 9 candidates, 8 confirmed by the books. 1 is flagged: a payment to an unverified payee that the books never recorded.
- **Forecast:** an April 2026 baseline from 12 months of SGD history.

Both samples are on `/data`. Tests: `tests/demo/pipeline.test.ts` and `tests/demo/multi-period.test.ts`.

## Limits

- **One business and one currency per processing.** Several businesses or currencies in one upload are quarantined, never mixed or converted.
- **Rule-based Q&A on a multi-month run answers for the whole run.** Per-month figures come from the monthly history question, Analytics or AI Q&A (`cash_summary` per month).
- **Nothing is persisted yet.** Results are not stored; that is checkpoint 10.
