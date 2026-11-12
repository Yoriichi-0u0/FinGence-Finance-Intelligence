# Automated ingestion: evaluation

This evaluates one scope item of the project brief, **automated ingestion of ledger, bank statement and financial system data**, against objective 4: "evaluate and benchmark the system's performance across key metrics including data accuracy". It covers ingestion only. Reconciliation, reporting, forecasting and anomaly detection are evaluated separately.

## What is being evaluated

FinGence reads a document it has never seen: a CSV, an Excel workbook, a text PDF, a scanned PDF or a photo.

1. A language model (`openai/gpt-oss-120b` on Groq) is shown the headings, column profiles and a few sample lines, and proposes the layout: which column is the date, the amount, the direction, and so on.
2. Fixed rules then re-read **every row of the original file** under that proposal and check it. The checks include the document's own arithmetic (running balance, stated totals), dates, signs, the account, the currency and the period.
3. The document is accepted only if every check passes. Otherwise it is quarantined with the reason.

The model never supplies an amount. No person approves or corrects anything.

## Protocol (fixed before run 5)

The targets and corpus below were committed before run 5 was started; the commit history shows the order.

### Corpus

| Set | Documents | Ground truth | Used while FinGence was developed? |
| --- | --- | --- | --- |
| FinGence samples | 10: the fictional March 2026 statement and ledger as unfamiliar CSVs, Excel, text PDFs, a scanned PDF and a photo | Phase 1 canonical files | Yes |
| Adversarial | 15 fixtures: 11 must be refused (opaque headings, corrupted balance, mislabelled columns, wrong account, non-financial table, sign traps), 4 are valid (including prompt injection in a cell, which may be accepted only exactly) | Expected decision | Yes |
| Generated, development | 30: 8 fictional banks and ledgers as CSV, XLSX, text PDF, and some as scanned PDF or photo | Generated transactions | Yes |
| **Generated, held-out** | **30: 8 further layouts written for this evaluation**, never used in development: German and Indonesian headings, dot-grouped numbers (1.234,56), EUR, THB and IDR, credit-before-debit order, a "Dr/Cr" column before the amount, a ledger with one signed amount column | Generated transactions | **No** |
| AgamiAI/Indian-Bank-Statements | 12 (6 digital, 6 scanned), external, Apache-2.0, synthetic INR statements | The dataset's own JSON | Read during development; the dataset's own running balances break 10–30 times per statement, so a correct system must refuse them |

All documents are fictional or public synthetic data. No real financial documents were used.

### Metrics and targets

A document is **accepted exactly** when it is accepted and every record matches the truth: same number of records, and each one's date and signed amount (to the cent), in order.

| # | Metric | Definition | Target |
| --- | --- | --- | --- |
| M1 | **False acceptance** | Accepted documents whose records differ from the truth in any way | **0** (reported with the 95% upper bound) |
| M2 | **Data accuracy of accepted records** | Dates and signed amounts that match the truth, over all accepted records | **≥ 99%** per field. This is stricter than the brief's 95% reconciliation accuracy, because an ingestion error carries into every later stage |
| M3 | **Straight-through processing**, digital | Valid CSV, XLSX and text PDF documents accepted exactly with no human input | **≥ 90%** (FinGence, development and held-out sets together) |
| M3h | Straight-through, **held-out digital** | The same, on held-out layouts only | **≥ 80%**: the generalisation test |
| M3s | Straight-through, scans and photos | The same, for scanned PDFs and photos | Reported, no target (known limitation: OCR digit misreads are refused) |
| M4 | **Invalid documents refused** | Adversarial documents that must be refused, refused | **100%** |
| M5 | **Document identification** | Accepted documents whose type (bank statement or ledger) and currency match the truth | **100%** |
| M6 | Reading accuracy | Rows the proposed layout reads exactly, before the checks decide | Reported |
| M7 | Time and cost | Seconds per document and per 100 rows, by format; model cost per document | Reported |
| M8 | **Manual verification** | A team member checks a random sample of accepted records against the documents themselves | **≥ 99%** agree (sheet produced by the run; needs the team) |
| M9 | **Ingestion time versus manual entry** | A team member keys a sample statement by hand and is timed; compared with M7 | Reported against the brief's 60% cycle-time reduction (needs the team) |

Rates are reported with Wilson 95% confidence intervals, because the corpus is small.

### What would count as failure

Any false acceptance fails the evaluation, whatever the other numbers. A held-out straight-through rate under 80% means the approach does not yet generalise to new layouts, and the report must say so.

## Results: run 5 (6 Nov 2026)

97 documents went through the live system: `openai/gpt-oss-120b` on Groq, two free-tier keys, and code at `806480c` plus the benchmark changes in this branch. The run took 32 minutes. One document (`agami/Digital_Type2/00002.pdf`) hit the provider's daily token allowance (`RATE_LIMITED`), so it is excluded and **96 are scored**. A malformed model reply is not excluded: it counts as a quarantine.

Reproduce: `node scripts/evaluate-ingestion.mjs .local/benchmark/ingestion-2026-11-06-r5.json --sheet <csv>`.

| # | Metric | Result | Target | Verdict |
| --- | --- | --- | --- | --- |
| M1 | False acceptances | **0** of 53 accepted documents (95% upper bound 5.5%) | 0 | **Met** |
| M2 | Data accuracy of accepted records | Dates 2,570 / 2,570 = **100%** (95% CI 99.9–100%). Signed amounts 2,570 / 2,570 = **100%** (99.9–100%) | ≥ 99% per field | **Met** |
| M3 | Straight-through, digital (all sets) | 44 / 56 = **78.6%** (95% CI 66.2–87.3%) | ≥ 90% | **Not met** |
| M3h | Straight-through, held-out digital | 12 / 24 = **50.0%** (95% CI 31.4–68.6%) | ≥ 80% | **Not met** |
| M3s | Straight-through, scans and photos | 5 / 14 = 35.7% (16.3–61.2%). Held-out only: 0 / 6 | Reported | — |
| M4 | Invalid documents refused | 11 / 11 = **100%** (95% CI 74.1–100%) | 100% | **Met** |
| M5 | Document type and currency identified | Type 49 / 49, currency 49 / 49 | 100% | **Met** |
| M6 | Rows read exactly by the proposed layout, before the checks | 3,925 / 5,879 = 66.8% | Reported | — |
| M7 | Time and cost | Median 11.7 s per document, 33 s per 100 rows. Model cost $0.093 for the run, about $0.001 per interpreted document | Reported | — |
| M8 | Manual verification | Sheet of 200 random accepted records produced | ≥ 99% agree | **Pending the team** |
| M9 | Ingestion time versus manual entry | Not yet timed | Reported | **Pending the team** |

**Time by format** (median):

| Format | Seconds per document | Seconds per 100 rows |
| --- | --- | --- |
| CSV | 3.8 | 8.3 |
| XLSX | 12.6 | 30.1 |
| PDF (text) | 11.2 | 7.4 |
| PDF (scanned) | 29.7 | 50.2 |
| Photo (JPEG) | 8.2 | 27.3 |

**By set** (accepted exactly / documents):

| Set | CSV | XLSX | PDF (text) | PDF (scanned) | Photo |
| --- | --- | --- | --- | --- | --- |
| FinGence samples | 4 / 4 | 2 / 2 | 2 / 2 | 1 / 1 | 1 / 1 |
| Generated, development | 8 / 8 | 8 / 8 | 8 / 8 | 2 / 4 | 1 / 2 |
| **Generated, held-out** | **4 / 8** | **4 / 8** | **4 / 8** | **0 / 4** | **0 / 2** |
| Adversarial (correct decision) | 15 / 15 | | | | |
| AgamiAI (must refuse: the source balances break) | | | 0 / 5 accepted | 0 / 6 accepted | |

## What the results show

**1. When FinGence accepts a document, it is right.** No false acceptance occurred in 53 accepted documents, and every one of the 2,570 accepted records matched the truth in date and amount to the cent. Every invalid adversarial document was refused, including a corrupted balance, mislabelled columns, the wrong account and a non-financial table. Every statement whose own arithmetic is broken (AgamiAI) was refused.

**2. On layouts it was developed against, it is fully automatic.** It accepted all 24 development digital documents (CSV, Excel, text PDF) exactly, with no human input.

**3. On new layouts, it is safe but not yet broadly automatic.** It accepted half of the held-out digital documents. It refused the other half rather than guessing, so the cost of an unfamiliar layout is a document left for review, never a wrong figure. This is the target the protocol said would show whether the approach generalises, and it was **not met**. The 12 refusals have four causes:

| Cause | Documents | What happened | Remedy |
| --- | --- | --- | --- |
| **Rule vocabulary** | 3: the Indonesian statement as CSV, XLSX and PDF | The checks that confirm the document's type and opening balance know English and Malay labels. "Rekening Koran" (bank statement) and "Saldo awal" (opening balance) were not recognised, so the document's role and first amount could not be confirmed | Add an Indonesian vocabulary. More generally, a vocabulary that grows by language |
| **Model mistakes caught by the checks** | 5: the Malay bank-account ledger (3, proposed as a bank statement), the THB statement CSV (one column mapped twice), the Labuan workbook (no date format given) | The model's proposal was wrong or incomplete. A check refused it, and the same layout in another format was accepted | Ask the model again with the failed check named (one retry). Use a stronger model |
| **Ambiguous by design** | 3: the USD ledger with one signed "Amount" column, as CSV, XLSX and PDF | Nothing in the document says whether a positive amount is cash in or out, and there is no running balance to tell. FinGence refuses to assume a convention | None needed: refusing is correct. This layout should not have been counted as acceptable |
| **A bug** | 1: the Kinabalu statement PDF (credit column before debit) | In the printed PDF, the "Total withdrawals" figure sits under the Credit column. The totals check bound it to the column it sits under instead of its label, so the totals contradicted each other and the document was refused | When a stated total's label and position disagree, follow the label. If they still disagree, refuse |

All six held-out scans and photos were refused. Four of them had OCR digit misreads (for example "172235iil" and "BENZ" read as amounts), the same limitation the development scans show (2 of 6 refused). The other two failed checks that the same layouts also fail as digital documents.

**Cost and speed.** About $0.001 per document in model cost. A typical statement is read in 4–12 seconds, a scan in about 30.

## Claim this evaluation supports

> FinGence's AI-assisted ingestion is **reliable**. In 96 scored documents it never accepted a wrong figure. Every accepted record (2,570) was exact. Every invalid or internally inconsistent document was refused. Documents in the layouts it was developed on are processed fully automatically. On layouts it had never seen, it accepted half automatically and refused the rest for review rather than guess. Broadening that coverage (a larger label vocabulary, a retry when a check fails, one totals fix) is the identified next step.

It does **not** support "fully automatic for any bank's statement". It does not support any claim about real (non-fictional) documents, because none were used.

## Limitations

- **Data:** all documents are fictional or public synthetic data. The generated corpora come from FinGence's own generator, so they share its rendering style even when the layouts are new. The external AgamiAI set is the independent one, and its own arithmetic is broken.
- **Sample size:** 53 accepted documents bound the false-acceptance rate at 5.5% with 95% confidence, not lower.
- **One model run:** model output varies between calls. The same layout was sometimes accepted in one format and refused in another.
- **Held-out set now used:** the fixes above must be checked on a **new** held-out set, not on this one, or the next result will be optimistic.
- **Still to do:** M8 and M9 need the team.

## For the team: M8 and M9

**M8, manual verification.** Open the sheet `manual-verification-r5.csv`: 200 records chosen at random (seeded) from the 2,570 accepted. For each row, open the named document and find the record. Write `Y` if its date, amount and direction match the document, or `N` with a note. Report agree / 200. The target is at least 99%: no more than 2 disagreements.

**M9, manual entry time.** One team member keys one statement by hand into a spreadsheet: date, description, signed amount. Use `heldout/labuan-myr-moneyinout-201.pdf`, 60 rows. Time it with a stopwatch, including checking your own entries. Compare with FinGence's median for a text PDF, 11.2 s per document. Report the reduction, 1 − FinGence time ÷ manual time, against the brief's 60%.

## Protocol amendment for run 6 (fixed after run 5, before run 6)

**Changes made after run 5.** All are in `lib/interpretation` and `lib/document-ingestion`.

1. **A stated total follows its label.** A total whose label names a side ("Total withdrawals", "Total debet") is bound to that side. Only a bare "Total" is bound by the column it is printed under. Swapped debits and credits are still refused by labelled totals.
2. **Vocabulary.** The heading, role, opening-balance, total and cash-account words gain Indonesian ("Rekening Koran", "Saldo awal", "Debet", "Buku Besar", "Kas"…) and German ("Kontoauszug", "Soll", "Haben", "Buchungstag", "Hauptbuch"…). A heading that names both sides, or neither, is still opaque.
3. **One more attempt.** When the model's proposal fails a check about its own reading of the layout (`schema`, `mapping`, `header`, `role-evidence`, `direction`, `dates`), the model is asked once more, told which check failed. The second proposal goes through every check again. A document whose arithmetic, account, scope or OCR figures fail is never re-asked. Both attempts are recorded and disclosed, and replay re-runs them in the same order.

**Held-out set A is no longer unseen.** The fixes were made by looking at its failures, so its run 6 result is reported but is not evidence of generalisation.

**Held-out set B.** It was written after run 5 and before run 6, and none of its layouts was looked at while making the fixes (`generate-statement-corpus.mjs --held-out-b`, seeds 301–308). It has 8 layouts and 30 documents:

- a D/C indicator column (MYR);
- PHP over two months;
- **French** headings ("Date opération", "Libellé", "Débit", "Crédit", "Solde"), a language the vocabulary does not cover;
- a signed bank column whose heading states the convention ("Net Cash Movement");
- BND over three months;
- a two-month MYR ledger;
- an **Indonesian ledger** ("Buku Besar"), in a language that change 2 just added;
- a signed ledger column whose heading states the convention ("Cash Movement").

Every set-B layout states its own conventions.

**Expectation corrected before run 6.** Set A's signed USD ledger ("Amount", no running balance) does not say which sign is cash in. Refusing it is the correct outcome, so from run 6 it is expected to be **refused**. Run 5's scores are left exactly as they were.

**Targets are unchanged.** M3b, set-B digital straight-through **≥ 80%**, is now the generalisation test. M1 (0 false acceptances) still fails the evaluation on any single event.

**Budget:** run 6 has more documents than one day of the free-tier token allowance (about 450k tokens, about 95 calls). It runs in parts, in this order: set B; set A; then the development, FinGence and adversarial regression; then AgamiAI. The parts are merged with `evaluate-ingestion.mjs`. Only `RATE_LIMITED` refusals are rerun.

## Results: run 6 (6, 7 and 11 Nov 2026)

Run 6 was scored against the amended protocol above. It used `openai/gpt-oss-120b` on Groq with two free-tier keys, and the ingestion code of `main` at `1698770`; the commits in this branch change only the benchmark and the scoring script. It ran in six parts because of the free-tier allowance: set B on 6 and 7 Nov, then set A, the development, FinGence and adversarial regression, and AgamiAI on 7 Nov. 23 documents hit the daily allowance (`RATE_LIMITED`) on 7 Nov and were rerun on 11 Nov with `FINGENCE_BENCH_IDS`, with nothing else changed. None hit the allowance in the rerun, so **all 127 documents are scored**. Model cost: $0.136 in total.

Reproduce: `node scripts/evaluate-ingestion.mjs` with the eight run files `ingestion-2026-11-06-r6-setB.json`, `ingestion-2026-11-06-r6-setB-full.json`, `ingestion-2026-11-07-r6-{setB,setA,corpus,fingence-adv,agami}.json` and `ingestion-2026-11-11-r6-rerun.json`. A document's last scored run counts.

**The 6 Nov partial runs agree.** Set B was first started on 6 Nov and stopped by the allowance. The 11 set-B documents that finished on 6 Nov (10 accepted exactly, 1 scan refused) had the same outcome on 7 Nov.

| # | Metric | Result | Target | Verdict |
| --- | --- | --- | --- | --- |
| M1 | False acceptances | **0** of 82 accepted documents (95% upper bound 3.6%) | 0 | **Met** |
| M2 | Data accuracy of accepted records | Dates 3,884 / 3,884 = **100%** (95% CI 99.9–100%). Signed amounts 3,884 / 3,884 = **100%** (99.9–100%) | ≥ 99% per field | **Met** |
| M3 | Straight-through, digital (FinGence, development, set A and set B) | 71 / 77 = **92.2%** (95% CI 84.0–96.4%) | ≥ 90% | **Met** |
| M3h | Straight-through, held-out set A digital | 18 / 21 = **85.7%** (95% CI 65.4–95.0%) | ≥ 80% | Met, but **set A is no longer unseen**, so this is not evidence of generalisation |
| **M3b** | **Straight-through, held-out set B digital: the generalisation test** | **24 / 24 = 100%** (95% CI 86.2–100%) | **≥ 80%** | **Met** |
| M3s | Straight-through, scans and photos | 7 / 20 = 35.0% (18.1–56.7%). Set A: 0 / 6. Set B: 2 / 6 | Reported | — |
| — | Ambiguous by design (set A's signed USD ledger) refused | 3 / 3 | 100% | **Met** |
| M4 | Invalid documents refused | 11 / 11 = **100%** (95% CI 74.1–100%) | 100% | **Met** |
| M5 | Document type and currency identified | Type 78 / 78, currency 78 / 78 | 100% | **Met** |
| M6 | Rows read exactly by the proposed layout, before the checks | 5,210 / 7,382 = 70.6% | Reported | — |
| M7 | Time and cost | Median 11.4 s per document, 35.6 s per 100 rows. About $0.0011 per interpreted document | Reported | — |
| — | Second attempts | 13 documents were asked twice. 1 was then accepted exactly (`corpus/lejar-tunai-malay-108.xlsx`), none falsely. The other 12 stayed refused: 8 correctly (ambiguous, adversarial or AgamiAI), and 4 valid (the Malay bank-account ledger in three formats, one scan) | Reported | — |
| M8 | Manual verification | Sheet of 200 random accepted records produced (`manual-verification-r6.csv`) | ≥ 99% agree | **Pending the team** |
| M9 | Ingestion time versus manual entry | Not yet timed | Reported | **Pending the team** |

**Time by format** (median):

| Format | Documents | Seconds per document | Seconds per 100 rows |
| --- | --- | --- | --- |
| CSV | 43 | 3.9 | 9.8 |
| XLSX | 26 | 8.0 | 11.0 |
| PDF (text) | 32 | 11.7 | 20.8 |
| PDF (scanned) | 19 | 20.0 | 41.7 |
| Photo (JPEG) | 7 | 11.6 | 36.4 |

**By set** (accepted exactly / documents), with run 5 for comparison:

| Set | CSV | XLSX | PDF (text) | PDF (scanned) | Photo | Run 5 digital |
| --- | --- | --- | --- | --- | --- | --- |
| **Held-out set B** (new) | **8 / 8** | **8 / 8** | **8 / 8** | 1 / 4 | 1 / 2 | — |
| Held-out set A (no longer unseen) | 6 / 8 | 6 / 8 | 6 / 8 | 0 / 4 | 0 / 2 | 12 / 24 |
| Generated, development | 7 / 8 | 8 / 8 | 7 / 8 | 2 / 4 | 1 / 2 | 24 / 24 |
| FinGence samples | 4 / 4 | 1 / 2 | 2 / 2 | 1 / 1 | 1 / 1 | 8 / 8 |
| Adversarial (correct decision) | 15 / 15 | | | | | 15 / 15 |
| AgamiAI (must refuse: the source balances break) | | | 0 / 6 accepted | 0 / 6 accepted | | 0 / 5 accepted |

Set A's two CSV, XLSX and PDF misses are the same two layouts in each format: the Malay bank-account ledger (refused) and the signed USD ledger (refused, as now expected). The table counts the USD ledger as not accepted; M3h counts it as correctly refused.

## What run 6 shows

**1. Still no wrong figure.** In 127 scored documents FinGence accepted 82, and every one of their 3,884 records matched the truth in date and signed amount to the cent. All 11 invalid adversarial documents and all 12 AgamiAI statements (whose own balances break) were refused.

**2. The fixes generalise to layouts nobody looked at.** Set B was written after run 5. None of its layouts was looked at while making the fixes, and it includes French headings, which the vocabulary does not cover. Every digital set-B document (24 of 24) was accepted exactly, against a target of 80%. With 24 documents the 95% lower bound is 86.2%, so the claim is "at least about 86% on unseen layouts like these", not 100%.

**3. Set A improved as intended.** The Indonesian statement (vocabulary), the Kinabalu PDF (a total follows its label), the THB CSV and the Labuan workbook were all accepted exactly. The signed USD ledger was refused, as now expected. One layout is still refused: the **Malay bank-account ledger** ("lejar bank") in all five formats. In CSV, XLSX and PDF, the model proposed a bank statement. The role check found that the document reads as a ledger and refused it. The second attempt, told which check had failed, made the same proposal. Refusing is the safe outcome, but it is a model limitation still to fix: a Malay ledger of a bank account is easy to mistake for a statement.

**4. Three development documents accepted in run 5 were refused in run 6.** The code and layouts did not change. The model's answer did:

| Document | What happened | Why it was not retried |
| --- | --- | --- |
| `corpus/sarawak-digital-drcr-105.csv` | The model proposed separate debit and credit columns for an amount with a "CR"/"DR" indicator ("RM 2,858.63", "CR"). The amounts check refused all 52 rows | An amounts failure is not one the protocol re-asks |
| `corpus/deccan-inr-quarter-106.pdf` | The provider rejected the model's reply because it did not match the required JSON schema (`json_validate_failed`, HTTP 400). Under the protocol a malformed reply counts as a quarantine | There was no proposal to check |
| `rimba-demo-kitchen-march-2026.xlsx` › Cash ledger | The model abstained, saying a ledger needs a per-row account column. The bank-statement sheet of the same workbook was accepted | An abstention is not re-asked |

These are **model variance**: about 3 in 32 development and FinGence digital documents changed outcome from run 5 to run 6, every time from accepted to refused, never to a wrong figure. The cost of variance is a document left for review. A retry for provider schema failures and abstentions is a reasonable next change, but it would have to be measured on a new held-out set.

**5. Scans and photos have not changed.** 7 of 20 were accepted. The refusals are OCR digit misreads ("172235iil", "BW3712", "BENZ" read as amounts), which the arithmetic checks refuse, as designed.

## Claim run 6 supports

> FinGence's AI-assisted ingestion is **reliable and generalises to new layouts**. In 127 scored documents it never accepted a wrong figure. All 3,884 accepted records were exact, and every invalid or internally inconsistent document was refused. On 24 digital documents in eight layouts written after the fixes and never looked at, including a language its vocabulary does not cover, it accepted every one exactly with no human input. Run-to-run model variance occasionally turns an acceptance into a refusal (3 of 32 regression documents), never into a wrong figure. Scans and photos remain limited by OCR.

It still does not support any claim about real (non-fictional) documents, and M8 and M9 still need the team.

## External documents (11 Nov 2026, outside the pre-registered targets)

Every set above came from FinGence's own generator, except AgamiAI. This part tests 35 text PDFs made by others, with the same code and model as run 6. Their truth and expected outcomes were fixed on 7 Nov, before any run. They are reported on their own, against no target.

- **Bankstatemently benchmark** (MIT), 5 statements: Singapore (SGD), Dutch (EUR, one signed column), Hong Kong (HKD and USD accounts), French-Canadian (CAD), and a **credit card** statement that must be refused.
- **Synthetic Indonesian Bank Statements** (MIT), 30 versions of two IDR statements: 2 clean, 7 with harmless changes (linearised, decrypted, re-paged, highlighted), and **21 tampered**. In the tampered versions an amount was edited by overlay, resizing, digit insertion, redaction, a stamp, page rewriting, flattening or re-encryption. Every tampered version must be refused.

Reproduce: `FINGENCE_BENCH_CORPUS=EXTERNAL` with the benchmark, then `node scripts/evaluate-ingestion.mjs .local/benchmark/ingestion-2026-11-11-external.json`. Model cost: $0.036.

| Measure | Result |
| --- | --- |
| **False acceptances** | **0**. Nothing was accepted |
| **Tampered or out-of-scope documents refused** | **22 / 22** (95% CI 85.1–100%): all 21 tampered statements and the credit card |
| Valid documents accepted exactly | **0 / 11** (95% CI 0–25.9%) |
| Documents that may be accepted only if exact (Dutch, Hong Kong) | 2 refused. Allowed |

**Why the tampered documents were refused.**

- **17 of 21: the edit itself was caught.** In 14, the overlay, resize, insert, stamp, re-page and spoof edits leave two amounts in the text layer at the edited line ("9,501,500.00 8,501,500.00"), and the amounts check refuses it. In 3 (the two redactions and the re-encryption), the running balance breaks at the edited line, and the balance check refuses it.
- **4 of 21: unreadable, not detected.** The four flattened versions have no text layer at all, so they were refused because no layout could be read. The tampering was not what refused them. Detecting it would need OCR plus the same checks.

**The credit card was refused, but not because it was recognised as one.** Like the other Bankstatemently documents, its transaction table was not found (below).

**Why the valid documents were refused.** Nothing was misread. FinGence refused rather than guess:

| Documents | Rows read exactly | Reason |
| --- | --- | --- |
| 9 Indonesian clean and benign versions | **50 / 50 in every one** | **Scope: the currency is not stated.** These statements print amounts with no currency code or symbol anywhere ("IDR", "Rp" or "rupiah" never appear). FinGence never assumes a currency, so the scope check refused them. The layout, amounts and balances were all read exactly |
| 4 Bankstatemently statements, and the credit card | 0 | **The model never saw the transaction table.** These are realistic multi-page statements that open with a cover and an account-summary page. The model said the lines it was shown had no table header, and abstained. In the Singapore statement, for example, the header ("Date, Description, Withdrawal (-), Deposit (+), Balance") only starts on page 2 |

**What this shows.**

1. The safety property holds on documents made by others: **no wrong figure was accepted**, including 21 deliberately tampered statements. 17 of those were refused because of the tampering itself, and 4 because they could not be read.
2. **Automation does not yet transfer to real-world statement layouts.** There are two specific causes. First, **finding the transaction table** in a multi-page statement with summary pages: the lines shown to the model should come from where the table starts. Second, a statement that does **not name its currency**: the account's currency could be supplied once by the user or the bank profile, instead of being refused. Both are next steps, and each would have to be measured on new external documents, not these.
3. This is the same conclusion as the run 6 claim, with one limit: "generalises to new layouts" holds for layouts like FinGence's generated statements, not yet for statements with cover and summary pages.
