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
