# Cash forecast v2: the category-driven cash plan

`lib/cash-forecast/plan.ts` plans the next six months of bank cash, category by category, from the verified bank
history and the cash classification (`docs/architecture/cash-classification-v1.md`). It drives the Forecasting page.
The v1 six-month baseline (`lib/poc-forecast`) is unchanged and is still shown for comparison, as is the local XGBoost
challenger.

## How each category is planned

Each category and direction gets a monthly series. Statement months come from the classification; earlier months come
from the payee rule.

| Pattern | Rule | Planned as |
|---|---|---|
| Every month | Present in at least nine of the last twelve months | Six-month average, or the same month last year scaled by the recent trend (last twelve months against the twelve before, or the last three against a year earlier), whichever missed less one month ahead on the months already known |
| At fixed intervals | Always the same gap of 2, 3, 4, 6 or 12 months | Average of its last three amounts, in the months it falls due |
| Now and then | Otherwise, with three or more occurrences | Its twelve-month monthly average |
| One-off | Seen once or twice, or not explained by the books | Left out and listed |

**Regular and scheduled payments** are payments for the next three months that are:
- paid in each of the last six months, with a median-based spread within 10%; or
- due at a fixed interval.

## Balance, range and accuracy

- **Opening balance:** the history's month-end running balance. It is used only when every running balance in the
  file equals the previous balance plus that record's signed amount. Otherwise the page shows the change in cash.
- **Testing:** the whole plan is tested by rolling origin on the last twelve months (from month seven when only twelve
  are known). Each origin plans only from the months before it.
- **Range:** the range at *h* months ahead is the average absolute cumulative miss at that distance. It is shown only
  with at least three tests.
- **Accuracy:** for receipts and payments, the miss is WAPE (weighted average percentage error); for net cash, it is
  the typical monthly miss in money. Each is set against the plain six-month average.

On the Full-year sample, over the 12 months of 2025:

| | This plan | Plain six-month average |
|---|---|---|
| Receipts miss | 13.97% | 17.74% |
| Payments miss | 16.10% | 16.24% |
| Typical net miss | MYR 23,765.67 | MYR 26,939.67 |

Pure, integer cents, no AI or trained model. Needs at least twelve consecutive verified months.
