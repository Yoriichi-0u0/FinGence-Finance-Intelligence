# Management report: human reconciliation review summary — issue #51

The existing management PDF and JSON (`/anomalies` → **Download PDF** / **JSON evidence**) now
carry a separate, read-only `reconciliationHumanReview` summary of the Finance reviewers'
current decisions on the original review-eligible reconciliation outcomes. No new route,
schema, dependency or financial calculation; the report still comes from one model, so PDF and
JSON quote the same figures.

## How it is bound

1. The report validates the persisted reconciliation exactly as before (`readScopedReconciliation`
   + `readReconciliation`: organization, business, month, currency and **bank SHA-256**, one
   ledger pair only).
2. Only then `lib/server/poc-anomalies/human-review.ts` looks up the persisted reconciliation that
   matches the organization, scope, bank SHA-256 **and ledger SHA-256** (exactly one row) and
   calls the existing `readReconciliationReviewAggregate` in the same Finance-authorized,
   audited transaction.
3. `readHumanReview` (`lib/poc-anomalies/reconciliation.ts`) accepts the aggregate only when its
   scope and both source identities equal the snapshot's, it has exactly the four states, and
   both `eligible` and the sum of states equal the snapshot's review-eligible outcomes (bank
   only, ledger only, amount, duplicate ambiguity and reference review).

Otherwise the summary is `UNAVAILABLE` with a reason, and the PDF says so; zero decisions are
never invented. Stored annotations that do not belong to the snapshot are treated as unavailable;
database and audit failures still abort the report.

## What the report says

PDF subsection **Human reconciliation review (annotations, not cleared transactions)**, after the
original reconciliation counts and before the unchanged **Anomaly review summary**:

| March demo | Before decisions | After one Explained + one Escalated |
| --- | --- | --- |
| Original review-eligible outcomes | 24 (7 bank only, 6 ledger only, 4 amount, 3 duplicate, 4 reference) | 24, unchanged |
| Open / Investigating / Explained / Escalated | 24 / 0 / 0 / 0 | 22 / 0 / 1 / 1 |

Original counts 151/6/7/6/4/3/4, MYR 2,516.06 signed difference, 14 anomaly candidates and the
source fingerprints are unchanged. **Explained does not mean matched, reconciled, cleared or
settled.** The full 6,000-row file (different bank SHA) reports reconciliation and human review
as unavailable.

## Limitations

- The summary shows current states only, not each decision's history or rationale (those stay on
  `/reconciliation`).
- Separate PDF and JSON downloads have their own generation time and report hash; figures and
  source fingerprints agree.
- Local synthetic PoC only; Production returns 404 as before.
