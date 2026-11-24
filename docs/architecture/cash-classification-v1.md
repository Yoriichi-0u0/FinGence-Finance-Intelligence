# Cash classification v1

`lib/cash-classification/` gives every verified bank record the category the business's own books use. It feeds the
Analytics page, and later the forecast and the report.

## Rules

1. **From the books.** A bank record that the reconciliation settled against ledger entries takes the ledger's own
   `CategoryLabel`, word for word, when every one of those entries states the same category. The settlement can be:
   - a matcher match;
   - a match recorded days apart;
   - a cleared timing item;
   - an exception naming both sides (same amount and date, a repeat the bank shows, a different amount, a duplicate posting).
2. **Stated bank rules** for records the books do not show:
   - a charge or fee becomes *Bank charges*;
   - a credit mentioning interest becomes *Interest received*;
   - a payment the bank repeated becomes *Repeated on the bank statement*;
   - any other record is *Not in your books*, which counts as not classified.
3. **Activities.** A category naming a loan, borrowing, financing, hire purchase, dividend or share capital is
   financing. One naming equipment, machinery, vehicles, plant or other fixed assets is investing. Everything else is
   operating, which is the remainder in a direct-method statement of cash flows.
4. **Earlier months** (the verified bank history) are classified by payee and direction. A payee whose money moves one
   way under exactly one category in this period's books gives the earlier record that category; any other payee
   stays not classified. Coverage is reported for both periods.

The bank file's own category columns (for example `HFCategoryLabel`) are evaluation labels and are never read.

## Checks (all must pass for the Analytics page to use the classification)

- Every verified bank record is classified exactly once.
- The operating, investing and financing totals add up to the bank movement, and so do the category totals.
- A books category is used only for a record the reconciliation settled against an entry carrying that category.

## Where it shows

- **Analytics:**
  - net cash from operating, investing and financing activities;
  - a direct-method statement of cash flows against the preceding equal-length period;
  - where cash went and came from;
  - customer concentration;
  - cash ratios (operating cash margin, payroll and materials against receipts, cover of regular costs);
  - the largest changes by category;
  - operating cash month by month.
- A ledger without a category column falls back to the payee view, and the page says why.

It is cash basis only: never revenue, expenses or profit.
