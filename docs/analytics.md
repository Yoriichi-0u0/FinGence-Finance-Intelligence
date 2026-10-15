# Financial analytics module (Frederick)

This module is an initial, testable analytics layer for FinSight. It consumes the
accepted canonical records produced by `lib/ingestion`; it does not parse files,
alter Chia's ingestion rules, reconcile records, or modify the mock-driven UI
pages owned by other teammates.

## Implemented in this increment

- Version-gated consumption of schema/ruleset `0.1`.
- Explicit policy for `WARNING` records (`include` by default or `exclude`).
  `REJECTED` rows are not present in `normalized` and are never consumed here.
- Monthly totals grouped by **period, currency, and monetary basis**. Decimal
  strings are summed with `BigInt` arithmetic, without converting accounting
  totals to JavaScript floating-point values.
- Deterministic financial metrics for explicitly interpreted period inputs:
  operating amount, operating margin, expense-to-revenue, budget variance, and
  revenue change.
- Naive and moving-average forecasting baselines plus one-step walk-forward
  evaluation (MAE, RMSE, MAPE where actuals are non-zero, and mean error).
- A robust median/MAD amount-outlier baseline grouped by currency, account code,
  and monetary basis. Findings retain source lineage and are review flags, not
  fraud determinations.

## Integration example

```ts
import { analyzeIngestionResults } from "@/lib/analytics/ingestion-adapter";
import { ingestDataset } from "@/lib/ingestion";

// `results` must be actual results produced by the ingestion engine.
const analytics = analyzeIngestionResults(results, "include");

console.log(analytics.monthlyAggregates);
console.log(analytics.anomalies);
console.log(analytics.prepared.counts);
```

The public API also exposes `prepareAcceptedRecords`,
`aggregateCanonicalRecords`, `calculateFinancialMetrics`, `forecastNaive`,
`forecastMovingAverage`, `evaluateNaiveWalkForward`, and
`detectRobustAmountAnomalies`.

## Important financial limitations

- The ingestion contract intentionally does not define a universal signed
  transaction amount. This module keeps `source_amount`, `debit`, `credit`, and
  `derived_ledger_net` separate. It does not label those as revenue, expense,
  cash inflow, or cash outflow automatically.
- `calculateFinancialMetrics` therefore accepts already-interpreted period
  inputs. Before deriving these from canonical records, the team/client must
  agree on chart-of-accounts mappings and bank/ledger conventions.
- Forecasting functions are transparent baselines, not a claim that a model is
  accurate. Production model selection needs enough chronological history and
  walk-forward evaluation on the project's data.
- The anomaly detector is a statistical baseline, not Isolation Forest and not
  a fraud classifier. Grouping reduces some comparability issues but cannot
  account for every vendor, seasonality, business event, or account policy.
- The canonical contract currently has no budget field, so budget variance
  requires a separately supplied budget source/model.
- Current dashboards, forecasting and anomaly pages still use mock data. This
  increment adds a reusable engine but does not connect UI state or persist
  results. The final data transport and API ownership should be agreed with
  Celester and the team before UI integration.

## Tests

Run the analytics and ingestion tests with:

```bash
pnpm test
```

The analytics tests cover version checks, warning policy, exact decimal
aggregation, currency/basis separation, deterministic ratios and variance,
forecast baselines/evaluation, and anomaly provenance/grouping.


## Reduced C1 accepted-data adapter

`lib/analytics/accepted-data-adapter.ts` adds `analyzeAcceptedDataPayload` as a
separate entry point for a reduced accepted-data payload. It does not replace
`analyzeIngestionResults` or change the ingestion schema/ruleset. Dataset-level
metadata restores the omitted provenance fields; `source_row_id` and
`source_row_number` remain per-record values.

The adapter derives `derived_ledger_net = debit - credit` only for
`monetary_basis === "debit_credit"` and only when both decimal strings are
present. It uses `BigInt`-based decimal arithmetic and does not assume a missing
side is zero. It does not derive ledger net for bank/source-amount records.

**Integration note:** this repository snapshot does not contain Chia's actual
C1 `AcceptedDataPayload` type. The type in the new adapter is a proposed
boundary based on the existing synthetic evidence export's dataset metadata.
Confirm the exact field names and omitted provenance fields against Chia's C1/C2
contract before merging.

The TypeScript target is ES2020 to support native `BigInt` literals. Vitest now
discovers all `tests/**/*.test.ts`, including the existing analytics tests.
