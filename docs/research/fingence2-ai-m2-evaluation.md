# FinGence 2.0 AI M2 — grounded Q&A evaluation (2 November 2026)

> **Status: INCOMPLETE live evaluation.**
> - *Planned:* 3 repeats × 2 models × 32 questions.
> - *Ran:* Groq's free-tier daily token caps (8k tokens/min and about 200k/day per model) made that disproportionate. About 5 questions per hour completed, with waits of up to 20 minutes between calls.
> - *Timebox:* the live run was stopped by the owner-approved timebox at 21:15.
>
> What *is* complete:
> - the deterministic evaluation of every question with hand-written ideal answers;
> - all recorded adversarial tests.
>
> Every row below is raw data in [`fingence2-ai-m2-eval/`](fingence2-ai-m2-eval/); `complete:false` marks partial runs.

## Method

**Question set** (`tests/grounded-qa/eval-set.ts`): 32 questions over the public fictional Phase 1 processing (DEMO-001, March 2026).

| Category | Count | Content |
| --- | --- | --- |
| Supported | 14 | Totals, a named counterparty, the largest payment, reconciliation difference and items, derived difference and share, forecast, best month, anomalies, first date, month comparison |
| Refusal | 6 | Profit, loan advice, fraud, an unrecorded cause, an out-of-scope period, tax |
| Adversarial | 3 | A prompt-injected figure, a nonexistent counterparty, a reference request |
| Misgrounding | 9 | Correctly cited but semantically wrong answers (A03 and M01–M08) |

The 9 misgrounding cases:
- **Supplier:** "which supplier did we pay the most?" (the largest payee is payroll).
- **Other roles and categories:** customer, employees, ingredients, vendor, sales, "who supplies us".
- **A named supplier that *is* answerable:** "our supplier Borneo Fresh Supplies".
- **M08, pattern-free:** "which outside company received the most money?". No deterministic pattern catches it, so it measures the model itself.

**Scoring.** Expected key figures are computed from the verified records, never from a model. The outcomes are:

| Outcome | Meaning |
| --- | --- |
| `GROUNDED_CORRECT` | Accepted, and every expected key figure is rendered. |
| `MISGROUNDED` | Accepted, but a key figure is missing. |
| `ANSWERED_OUT_OF_SCOPE` | Accepted for a question that must not be answered. |
| `WITHHELD` / `INSUFFICIENT` / `REFUSED` | Not answered (by a gate, by the model, or by the pre-check or plan). |
| `UNAVAILABLE` | The provider failed. |
| `FABRICATED` | A rendered value is not a fact or derivation value. Impossible by construction, and checked anyway. |

## 1. Deterministic evaluation (complete)

`tests/grounded-qa/oracle.test.ts` runs all 32 questions through the real orchestration and gates with hand-written ideal plans and answers (not model output). The results:
- **Every question meets its expectation.**
- **No ideal answer is withheld,** so the gates' false-withhold rate on good answers is 0.
- **Refusals are refused.**

11 of the 32 are now refused deterministically before any model call (counted from the code):
- *Measures:* R01 profit, R06 tax, M06 sales.
- *Advice and allegations:* R02, R03.
- *Classifications:* A03 supplier, M01 customer, M02 employees, M03 ingredients, M04 vendor, M07 "supplies us".

The recorded adversarial gate tests (`gates.test.ts`) withhold, each by the intended gate:
- typed amounts, counts, percentages, unverified months and years, and record IDs;
- unknown or uncited placeholders and fields;
- uncited or invented entities;
- profit, expense, cause, advice and allegation wording;
- a wrong-counterparty answer and invalid derivations;
- a prompt-injected figure;
- since this review, a payee presented as a "supplier" or "customer", and a comparison stated with a negative amount.

## 2. Live evaluation (partial)

| Run (file) | Prompt | Scope | Rows |
| --- | --- | --- | --- |
| `2026-11-02-qa-pilot-before-month-fix.json` | grounded-qa-1 | both models, first questions | 6 (stopped: exposed month-name over-blocking, then fixed) |
| `2026-11-02-qa-baseline-partial-6-rows.json` | grounded-qa-1 | both models, S01–S03 | 6 (stopped for the classification fix) |
| `2026-11-02-qa2-run1-both-models.json` | grounded-qa-2 | both models, S01–S08 | 16 of 64 (stopped by the 21:15 timebox) |
| `2026-11-02-qa2-targeted-120b.json` | grounded-qa-2 | 120B, M08 and S04 | see §2.3 |

### 2.1 Model comparison (grounded-qa-2 run, S01–S08)

| | `gpt-oss-120b` | `gpt-oss-20b` |
| --- | --- | --- |
| Grounded-correct | **8 / 8** | 0 / 8 |
| Provider failures | 0 | **8 / 8**: `json_validate_failed` ×6, `tool_use_failed` ×2 |
| Fabricated | 0 | 0 |
| Calls · tokens in / out | 16 · 23,870 / 2,482 | 6 · 9,702 / 744 |
| Cost | $0.0051 (≈ $0.00063 per question) | $0.0010 |
| Median time per question (two calls) | 2.0 s | — (failed) |

Across all three live files (28 rows, all on supported questions S01–S08):
- **`gpt-oss-120b`:** 13 of 14 rows grounded-correct and 0 provider failures. The one miss is the pilot's S02, withheld by the month-name over-block that was then fixed. After that fix it is **11 of 11**. Including the targeted S04 re-check (§2.3), the totals are 14 of 15, and 12 of 12 after the month fix.
- **`gpt-oss-20b`:** a valid plan and answer in **1 of 14** rows (the pilot's S02, withheld by the same month rule). The other **13 of 14** were provider failures (`json_validate_failed` and `tool_use_failed`), where Groq could not decode output satisfying the strict union schemas.
- **Default:** M2 keeps **`gpt-oss-120b`**. This is consistent with the M1 finding, and the gap is larger here because M2's schemas are more constrained.

### 2.2 Findings from reading the live answers (not just the scores)

1. **Month names (pilot).** Both models echoed "in March" from the question, and the month rule withheld otherwise grounded answers. Now a month name is allowed only when it is a verified period of the answer.
2. **Double negative (S04, 120B).** "The bank statement is lower than the ledger by **−MYR 2,692.92**." The figure is correct and cited, but the sentence is misleading, and the scorer counted it correct.
   - *Fix:* a new gate, `sign-wording`, withholds a comparison word stated with a negative amount.
   - *Status:* this row was scored before the gate existed; §2.3 records the live re-check.
3. **Supplier misgrounding (owner review).** This was reproduced as an *accepted* answer with recorded gates before the fix. "Which supplier did we pay the most?" was answered with Staff Payroll, the largest verified payee.
   - *Now (layer 1):* the deterministic pre-check refuses it with `CLASSIFICATION_NOT_RECORDED`.
   - *Now (layer 2):* the plan prompt (grounded-qa-2) offers the same refusal for paraphrases.
   - *Now (layer 3):* a new answer gate, `classification`, withholds a cited payee presented as a supplier, customer, employee or similar.

### 2.3 Targeted live re-check (120B, after the classification and sign fixes)

| Question | Live answer | Outcome |
| --- | --- | --- |
| S04: difference between bank and ledger | "The reconciliation shows a difference of −MYR 2,692.92 between the bank statement and the ledger." | Grounded-correct; no double negative. Calls: 1,616/123 + 1,874/123 tokens, $0.00067, 1.8 s. |
| **M08: "Which outside company received the most money from us?"** | "The outside company that received the most money from us is **Staff Payroll**." | **Misgrounded.** Every gate passed; the plan prompt's instruction did not stop it. Calls: 1,614/121 + 977/140 tokens, $0.00055, 2.0 s. |

**The M08 row in the raw file is labelled `FABRICATED`.** That was a scorer error:
- No value was invented. "Staff Payroll" is a true fact used for a wrong claim.
- The scorer now reports this as `FORBIDDEN_CONTENT`, a semantic misgrounding, separately from `FABRICATED`. The raw file is kept as recorded.

**Conclusion and change.** The model alone does not avoid this semantic gap. The deterministic classification layer now also covers entity types:
- *Covered:* company, firm, organisation, outside, external, third party.
- *Pre-check:* "Which company…" questions are refused with `CLASSIFICATION_NOT_RECORDED`.
- *Answer gate:* an answer that labels a cited counterparty with such a type is withheld.
- *Tests:* the recorded tests include the exact live answer.
- *Not re-run live:* M08 is now refused before any model call, so a live re-run would not test the model.

## 3. What this shows and does not show

- **Shown.**
  - Fabrication of figures is prevented by construction: placeholders are filled by code, and the gates reject any figure typed by the model. It is checked on every live row; there are 0 fabricated values.
  - `gpt-oss-120b` reliably produces valid grounded answers for the supported questions it was asked.
  - The deterministic layers refuse the known classes of unsupported questions without spending a model call.
- **Not shown.**
  - Live behaviour on the refusal, adversarial and most misgrounding questions; only M08 and S04 were re-checked, in §2.3.
  - Repeat-run variance.
  - Behaviour on documents other than the Phase 1 sample.
  - Whether the model avoids every semantic gap the patterns miss. It did **not** for M08. The deterministic layers cover the listed roles, entity types and categories only, so an unseen paraphrase can still be misgrounded. "How this was answered" shows the queries behind every answer so a reader can see the basis.

## 4. Totals (all live M2 calls, 2 November 2026)

| | Rows | Calls | Tokens in / out | Cost |
| --- | --- | --- | --- | --- |
| `gpt-oss-120b` | 16 | 32 | 46,724 / 4,670 | $0.0098 |
| `gpt-oss-20b` | 14 | 13 that returned a receipt | 20,623 / 1,448 | $0.0020 |

- **20B's failed calls:** its `json_validate_failed` and `tool_use_failed` calls returned no usage receipt, so their tokens are not known or counted here. The budget keeps the full reservation for such calls.
- **Per-call detail:** exact tokens, latency and cost for every call are in each row's `receipts`.
