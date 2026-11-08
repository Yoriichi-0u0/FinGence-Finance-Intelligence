# FinGence reconciliation layer v1 — contract

4 November 2026. The reconciliation layer turns verified bank and cash-ledger records into a **fully resolved reconciliation**. It is the second of FinGence's layers and reads only the ingestion layer's output ([ingestion layer v1](ingestion-layer-v1.md)).

It runs **autonomously**, following the owner's decision that FinGence processes everything without human approval or review:

- There is no review queue.
- Every exception gets exactly one resolution from a stated rule.
- Only an exception that no rule explains is flagged. It goes to the technical team (Management), not to the Finance user.

## Interface

`lib/reconciliation/reconcile.ts`

```ts
reconcile(bank: CashSource, ledger: CashSource, options: { organizationId: string; scope?: CashSourceScope }): ReconciliationResult
outcomeOf(result): ReconciliationOutcome   // the same result without each month's echoed snapshot and statement
entriesCsv(entries): string                // correcting entries as CSV; formula-like cells neutralised
```

- **Inputs:** two verified cash sources (`lib/poc-reconciliation/contracts.ts`). `normalizeCashSourceBytes(bytes, kind, filename, sha256, scope)` reads them from a supported or AI-canonical table.
- **`scope`:**
  - `RECONCILIATION_SCOPE` (`{ months: 'MANY', currencies: 'ANY' }`, the default) accepts several months and any one ISO currency per business.
  - `PHASE1_CASH_SCOPE` (one month, MYR) is what the Phase 1 pipeline passes.
  - In either scope, one business and one currency per pair; otherwise the layer throws `BUSINESS_MISMATCH` or `CURRENCY_MISMATCH`.
- **`periods[]`, one per calendar month that both sources cover:**
  - `snapshot`: the unchanged matcher (`reconcileCashSources`);
  - `statement`: the reconciliation statement, with linked items reclassified;
  - `items[]`: every exception with its `resolution`, a plain-language `summary` and its `link`;
  - `entries[]`: the correcting entries for that month;
  - `checks` and `status`.
- **Whole-run fields:**
  - `status`, `summary` (plain language for Finance) and `totals`;
  - `entries`: every correcting entry;
  - `attention`: the unexplained items;
  - `checks` and the stated `rules`;
  - `notReconciled`: months only one side covers.

## How it works

1. **Each month goes through the unchanged matcher.** A match needs a unique reference, currency and signed amount within two days. `buildStatement` then classifies the open exceptions (deposit in transit, unpresented cheque, bank charge, missing receipt or payment, amount error, duplicate, reference-only).
2. **Exceptions are linked across days and months.** Two single open records, one on each side, are linked when they have the same non-empty reference and signed cents, fall inside the clearing window, and each is the other's only candidate.
   - Clearing windows: receipts within 7 days, payments within 45 days, and ledger bookings within 7 days after the bank.
   - Every candidate pair is found before any is used, so record order cannot create a link.
   - A record in a later month that only the bank (or only the ledger) covers can serve as clearing evidence. For example, next month's bank statement can clear this month's deposit in transit even if the ledger stops at month end.
3. **Each exception gets one resolution:**

| Resolution | Rule | Statement category |
| --- | --- | --- |
| `MATCHED_LATE` | Linked within the same month, more than two days apart | `LATE_MATCH` (no effect) |
| `MATCHED_BY_AMOUNT` | Same date and amount, unique on both sides, references differ | `REFERENCE_ONLY` (no effect) |
| `TIMING_CLEARED` | Linked across months | Earlier month: `DEPOSIT_IN_TRANSIT`, `UNPRESENTED_CHEQUE`, `PAYMENT_IN_TRANSIT` or `LEDGER_POSTED_LATE`. Later month: `CLEARED_PRIOR_PERIOD_ITEM` |
| `TIMING_OPEN` | Deposit in transit or unpresented cheque whose clearing window runs past the last bank statement supplied | Unchanged |
| `ENTRY_PREPARED` | Bank charge, receipt or payment missing from the ledger, a ledger amount error, or a duplicate ledger posting | Unchanged; balanced correcting entries are prepared |
| `UNEXPLAINED` | No rule applies, or an item that should have cleared within its window on the statements supplied did not | `UNEXPLAINED` (full effect kept) |

**Correcting entries** are double-entry lines against `Cash at bank (1000-BANK)`:

| Exception | Debit | Credit |
| --- | --- | --- |
| Bank charge | Bank charges | Cash at bank |
| Receipt not in the ledger | Cash at bank | Receipts to be identified |
| Payment not in the ledger | Payments to be identified | Cash at bank |
| Ledger amount error | A correction of the original entry | |
| Duplicate posting | A reversal of every extra copy | |

For a duplicate, the copy kept is the one with the posting date closest to the bank record, then the lowest ID (`duplicateChoice`); no human choice is needed. Entries are **prepared for the books and never posted** to any accounting system.

## Guarantees (checks on every run)

- **Per month, with linked items included:**
  - the exceptions' effects equal the difference;
  - each exception record is listed once;
  - adjusted bank − adjusted ledger = unexplained;
  - the correcting entries carry exactly the ledger-side corrections, and every entry's debit equals its credit.
- **Whole run:**
  - every month passes;
  - every link pairs two opposite records of equal amount;
  - every record in a reconciled month is matched or resolved exactly once;
  - every exception has exactly one resolution.
- **When a check fails:** the status is `CHECKS_FAILED`, the RECONCILE stage is quarantined, and the summary says that no result is final.
- **Single-month input:** a single month with nothing linked gives exactly the Phase 1 snapshot and statement. `tests/reconciliation/layer.test.ts` asserts this on the Phase 1 sample.
- **Determinism:** the outcome is independent of record order.

## Integration

- **Pipeline:** `lib/demo/pipeline.ts` RECONCILE calls `reconcile` with the Phase 1 scope.
  - `outputs.reconciliation` and `outputs.statement` are its month's snapshot and statement.
  - `outputs.resolution` is the layer outcome.
  - Only unexplained items enter `quarantine` (as `RECONCILIATION_EXCEPTION` / `UNEXPLAINED`).
- **Phase 1 sample:** 50 matched outcomes and 9 exceptions, all resolved: 2 timing items open, 6 correcting entries prepared, 1 matched by amount, 0 unexplained.
- **Finance UI:** the Reconciliation page shows "What FinGence did": the summary, what was corrected, what is on its way, the correcting-entries table with a CSV download, and the rules and checks folded away for technical users. Overview, Data and Reports carry the same figures.

## Limits

- **Multi-month documents on `/data`:** supported since 5 November 2026. Every stage handles several months and any one currency ([multi-period processing v1](multi-period-processing-v1.md)).
- **Persistence:** reconciliation results are not yet stored. The ingestion store keeps the records, so a stored run can be reconciled again deterministically.
- **Management view:** unexplained items are reported in the outcome and in processing details. The Management console that lists them lives in the held workspace branch (PR #74).
- **Movement basis:** the documents give monthly cash movements, not opening and closing balances.
