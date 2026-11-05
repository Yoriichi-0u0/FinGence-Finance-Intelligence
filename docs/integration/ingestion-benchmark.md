# Ingestion-layer benchmark

The live benchmark sends every document of a mixed corpus through `ingestDocuments` with the ingestion scope (any
months, any stated currency) and the live layout interpreter (`openai/gpt-oss-120b` on Groq, two keys). Each
accepted document's records are compared, in order, with ground truth: the date and signed cents of every
transaction.

- **False acceptance:** an accepted document whose records differ from the truth. The target is 0.
- **Rows read exactly:** how many rows the model's proposed layout reads correctly from the document, whatever the gates then decide. It separates reading accuracy from acceptance.

## How to run

```bash
CHROME="/path/to/Chrome" node scripts/generate-statement-corpus.mjs            # .local/benchmark/corpus (not committed)
FINGENCE_INGESTION_BENCHMARK=1 FINGENCE_BENCH_AGAMI_DIR=.local/datasets/agami \
  npx vitest run tests/document-ingestion/benchmark.test.ts                   # needs GROQ_API_KEY (and GROQ_API_KEY2)
```

Results are written to `.local/benchmark/ingestion-<date>.json`, with a `.md` table next to it. `FINGENCE_BENCH_ONLY` filters documents by name.

**Budget:** a full run is about 67 model calls, or about 250k tokens. That is close to the Groq free tier's daily token allowance, so run the corpus and the external set on different days, or use a paid key.

## Corpus

| Set | What it is | Ground truth |
| --- | --- | --- |
| FinGence samples | The fictional March 2026 statement and ledger, as unfamiliar CSVs, an Excel workbook, text PDFs, a scanned PDF and a ledger photo | The Phase 1 canonical files |
| Adversarial | 15 fixtures: opaque headings, a corrupted balance, mislabelled columns, prompt injection, another currency, a non-financial table, sign and account traps | Expected quarantine, except 4 that are valid |
| Generated (`scripts/generate-statement-corpus.mjs`) | 8 fictional banks and ledgers, each as CSV, XLSX, a text PDF printed by Chrome (headings repeated per page, page numbers, one watermark), and for some a scanned PDF or a photo. They vary: English and Malay headings; six date formats; plain or grouped numbers with `RM ` or `Rs. ` markers; split, signed and DR/CR amounts; MYR, SGD, USD and INR; one to three months; long wrapped descriptions | Generated transactions |
| AgamiAI/Indian-Bank-Statements | External, Apache-2.0, synthetic Indian business statements: 6 digital and 6 scanned PDFs, 6 pages each, about 160 transactions, quarterly, INR, with a diagonal watermark | The dataset's JSON |

## Results

### Run 1 (4 Nov 2026, before the real-statement fixes): 67 documents, 0 false acceptances

| Set | Format | Docs | Accepted exactly | Quarantined | False acceptances | Meets expectation | Rows read exactly |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FinGence | CSV | 4 | 4 | 0 | 0 | 4 | 228 / 228 |
| FinGence | XLSX | 2 | 2 | 0 | 0 | 2 | 114 / 114 |
| FinGence | PDF (text) | 2 | 2 | 0 | 0 | 2 | 114 / 114 |
| FinGence | PDF (scanned) | 1 | 1 | 0 | 0 | 1 | 57 / 57 |
| FinGence | JPEG | 1 | 1 | 0 | 0 | 1 | 57 / 57 |
| Adversarial | CSV | 15 | 4 (all valid ones) | 11 (all invalid ones) | 0 | 15 | — |
| Generated | CSV | 8 | 5 | 3 (provider) | 0 | 5 | 226 / 392 |
| Generated | XLSX | 8 | 4 | 4 (provider) | 0 | 4 | 156 / 392 |
| Generated | PDF (text) | 8 | 0 | 8 | 0 | 0 | 225 / 392 |
| Generated | PDF (scanned) | 4 | 0 | 4 | 0 | 0 | 119 / 176 |
| Generated | JPEG | 2 | 0 | 2 | 0 | 0 | 31 / 62 |
| AgamiAI | PDF (text) | 6 | 0 | 6 | 0 | 0 | 809 / 973 |
| AgamiAI | PDF (scanned) | 6 | 0 | 6 | 0 | 0 | 0 / 973 |

**What it found, and what was changed (`3aed88c`):**

1. **Strict-schema failures (14).** The model correctly set a missing reference column to `null`, which the schema forbade. The reference column is now optional.
2. **Totals printed directly under a table** (no blank line) were read as transactions. Totals and balance-forward lines without a date are now excluded and disclosed, at the edges or between pages.
3. **`Rs.`-prefixed figures** were not recognised as figures, so a footer was merged into the last row. Currency-prefixed figures are now anchors, and a totals line is never a continuation.
4. **A two-cell preamble line** ("Currency MYR") was joined to the headings. A heading fragment must now sit as close to the headings as the headings sit to the first row.
5. **Long letterheads** pushed the table header beyond the evidence window (scans: the model abstained) and beyond `headerLine ≤ 40`. The lines around a late header are now shown, and `headerLine ≤ 400`.
6. **Wrapped descriptions between a repeated heading and the first transaction** hid the heading on later pages. Heading detection now looks three lines ahead.
7. **A failed transaction printed with no amount** is now read as no cash movement, but only when the running balance confirms it is unchanged.
8. **OCR digit errors** both passes made: figures that are not well formed, or that the engine doubts, get a digits-only re-read as an extra alternative for `verifyWithDisputes`.

**AgamiAI is internally inconsistent.** Its own JSON breaks the running balance 10 to 30 times per statement, around generated rent, GST and reversal entries, and its opening balance plus transactions never equals the closing balance. FinGence read the digital statements' rows almost entirely correctly (809 of 973 rows, 162 of 162 on statement 00001) and **refused every one**, because the documents' own arithmetic fails. That is the intended behaviour.

### Run 3 (5 Nov 2026, after the fixes): incomplete

The generated kenyalang statement, which had failed as a PDF in run 1 (`dates: "Total withdrawals"`), was accepted exactly as CSV, XLSX and text PDF. Its scan was quarantined on two OCR digit errors. The remaining 36 documents could not be interpreted: `RATE_LIMITED`, because both free-tier keys had used their daily token allowance (about 500k tokens over the two days). The full rerun is pending.

### Run 4 (5 Nov 2026, full rerun after the fixes): 67 documents, 0 false acceptances

The generated corpus and the FinGence and adversarial sets ran first (55 documents, 739 s). AgamiAI ran next (12 documents, 809 s). Both used the two free-tier keys on the same day. The one change made after this run, OCR currency case, was then rerun live on the document it affects. That row is marked †.

| Set | Format | Docs | Accepted exactly | Quarantined | False acceptances | Meets expectation | Rows read exactly |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FinGence | CSV | 4 | 4 | 0 | 0 | 4 | 228 / 228 |
| FinGence | XLSX | 2 | 2 | 0 | 0 | 2 | 114 / 114 |
| FinGence | PDF (text) | 2 | 2 | 0 | 0 | 2 | 114 / 114 |
| FinGence | PDF (scanned) | 1 | 1 | 0 | 0 | 1 | 57 / 57 |
| FinGence | JPEG | 1 | 1 | 0 | 0 | 1 | 57 / 57 |
| Adversarial | CSV | 15 | 4 (all valid ones) | 11 (all invalid ones) | 0 | 15 | — |
| Generated | CSV | 8 | 8 | 0 | 0 | 8 | 392 / 392 |
| Generated | XLSX | 8 | 8 | 0 | 0 | 8 | 392 / 392 |
| Generated | PDF (text) | 8 | 8 | 0 | 0 | 8 | 392 / 392 |
| Generated | PDF (scanned) | 4 | 2 | 2 | 0 | 2 | 171 / 176 |
| Generated | JPEG † | 2 | 1 | 1 | 0 | 1 | 61 / 62 |
| AgamiAI | PDF (text) | 6 | 0 | 6 | 0 | 0 | 482 / 973 |
| AgamiAI | PDF (scanned) | 6 | 0 | 6 | 0 | 0 | 0 / 973 |

**Compared with run 1:**
- Generated digital documents (CSV, XLSX and text PDF) went from 9 of 24 accepted exactly to **24 of 24**.
- Every FinGence sample and every adversarial expectation still holds.
- AgamiAI rows read exactly went from 320 to 482.

**What remains quarantined, and why that is correct:**

1. **OCR digit misreads (4 scans or photos).** Each document gets one quarantine reason; this is what was cited.
   - kenyalang scan: "2,02243" for 2,022.13, and an unreadable "(15722500),".
   - rajang scan: one balance figure misread, so 36 of 37 balance changes agree.
   - lejar photo: "E6358".

   These change a digit, so neither the arithmetic nor the second OCR pass can recover the printed value with certainty, and the gates refuse the document. Better scan quality or a stronger OCR engine is the remedy, not a looser gate.
2. **AgamiAI Type 1 digital (3).** Read exactly: 162/162, 161/161, 159/159. Refused because the dataset's own running balance breaks 10 to 20 times per statement.
3. **AgamiAI Type 2 digital (3).** The model mapped one column to two fields ("one column used twice"). A layout with a separate `Cr/Dr` column, three date columns and a transaction ID is not yet read. Even when read, these statements would be refused, because their balances break 16 to 30 times.
4. **AgamiAI scans (6).** OCR confidence is 39–86% on six watermarked pages. The model abstains or the table does not hold together.

**Fix from this run:**

- **OCR currency case.** OCR read the cell "USD" as "UsD", so the pelita photo was refused although all 30 rows had been read exactly. For an OCR table only, a currency code on the cited line may be read case-insensitively. The conditions:
  - exactly one three-letter code is on that line, counted as whole words of the full line, not of the model's quoted text;
  - the model's quoted text names that code;
  - it has at most one letter in the wrong case;
  - its upper-case form is an ISO 4217 code.

  The correction is disclosed.

  Text layers and spreadsheets stay strict. Two wrong-case letters ("Usd") or a non-ISO code stays quarantined (`tests/interpretation/extract.test.ts`). Rerun live: pelita photo **accepted exactly**, 30/30 rows, USD.

**Across every run: 0 false acceptances in 67 documents per full run.**
