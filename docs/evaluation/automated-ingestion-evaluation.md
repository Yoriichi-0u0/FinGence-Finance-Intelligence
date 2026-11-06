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

## Results

Pending run 5.
