# Processing confidence: definition and calibration (12 November 2026)

SAIC (Mr Farish) asked that a Finance user see **how confident FinGence is** in its processing instead of the technical detail. FinGence shows it as a percentage. The definition is in [`lib/confidence/index.ts`](../../lib/confidence/index.ts):

> **Confidence** is how much of this period's bank movement, by value, FinGence read reliably, checked and explained. **It is not a probability of being right.**

A bank record counts towards the percentage only when all three hold:

| Condition | A record counts when |
|---|---|
| **Read reliably** | its statement was read by a known layout, by an AI-proposed layout that passed every gate, or by OCR at a mean confidence of at least **90%** with its amounts confirmed by the arithmetic anchor |
| **Checked** | every stage behind the figures (identify, extract, interpret, verify, reconcile, analyse) was verified. If one was not, there is **no percentage**: the result is shown as incomplete. The forecast and report stages don't count: a forecast is legitimately unavailable without seven months of history |
| **Explained** | it is matched to the books or resolved by a stated rule (timing, correcting entry), against a ledger that was itself read reliably, and it is not an unusual record the books could not settle |

**Bands:** 98% and above is **High**; 90–98% is **Check advised**; below 90% is **Low**.

The percentage is rounded down to one decimal, so it never shows 100% unless every cent counts. The popover lists what fell short, by value and with the reason.

## Calibration of "read reliably" (no model calls)

`scripts/calibrate-confidence.mjs` re-scores saved benchmark results; it makes no model calls.
- **Inputs:** the run 6 parts (set A, set B, development corpus, FinGence and adversarial fixtures, AgamiAI) plus the 11 Nov rerun, and the external-documents set. The rerun replaces the rows it repeats.
- **Check:** for every document FinGence accepted, the script compares the rule's rating with the ground truth.

| | Exact against the ground truth | Wrong |
|---|---|---|
| Rated **read reliably** | 81 | **0** |
| **Not** rated reliable | 1 | 0 |

That covers 162 documents: 82 accepted and 80 set aside.

- **No document the rule trusts was wrong.** The one it does not trust is a scan read by OCR at 85% mean confidence, and it was in fact read exactly. So the 90% line errs on the safe side; it costs one correct scan a lower rating.
- **Accepted OCR confidences:** 85, 90, 92, 92, 93, 93, 93.

**Limitations:**
- The corpus has no accepted document with a wrong figure (run 6 has 0 false acceptances), so the rule's ability to catch a wrong reading is supported by the gates' record, not by an observed case.
- The "explained" condition is deterministic and comes from the reconciliation layer's own outcomes; it was not part of this calibration.
- Re-run the script after every evaluation run, and move the threshold only on that evidence.
