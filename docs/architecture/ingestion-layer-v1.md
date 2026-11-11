# FinGence ingestion layer v1 — contract

4 November 2026. The ingestion layer turns uploaded financial documents into **verified records**. It is the first
of FinGence's layers. Reconciliation, analytics, anomalies, forecasting, reporting and Q&A read its output and
never re-read a document.

## Interface

`lib/document-ingestion/ingest.ts`

```ts
ingestDocuments(inputs: DocumentInput[], options?: IngestionOptions): Promise<{ documents: ProcessedDocument[]; effective: Uint8Array[] }>
```

- **`inputs`:** `{ name, bytes, provenance }` per uploaded file.
- **`options.interpreter`:** the layout interpreter (the server gateway, or a recorded double in tests). Without it, only exact-schema documents are accepted.
- **`options.scope`:** what one document may cover.
  - `INGESTION_SCOPE` (`{ months: 'MANY', currencies: 'ANY' }`) accepts several months and any currency the document states verbatim.
  - The Phase 1 pipeline passes its own rule: one month, MYR.
- **`documents[i]`:** name, `sha256` (of the document's table), provenance, role, decision (`AUTO_ACCEPTED` / `QUARANTINED`), reason, and:
  - `source`: workbook sheet, PDF text layer or OCR, with the uploaded file's SHA-256, page count, OCR confidence and conversion notes;
  - `interpretation`: the model proposal, receipt (model, tokens, cost, LIVE/REPLAYED), every gate check, the column mapping, disclosures and the canonical SHA-256.
- **`effective[i]`:** the bytes the document continues as. For an AI-interpreted document this is the canonical CSV (one row per transaction: record ID, business, date, currency, reference, description, counterparty, signed cents), with the source line of each row kept. Otherwise it is the document's own table.

The Phase 1 pipeline (`lib/demo/pipeline.ts`) calls `ingestDocuments` and then reconciles. Its results and processing IDs did not change when the layer was extracted.

## Formats

| Input | How it becomes a table |
| --- | --- |
| CSV | Read as text. |
| XLSX | Every worksheet that holds a table is one document. Text is verbatim, numbers are kept at Excel precision, dates become ISO. |
| PDF with a text layer | pdf.js word positions → `positioned.ts`. |
| Scanned PDF | A page that is one stored JPEG is read from the image itself; any other scanned page is rendered at about 300 dpi (browser only). The scan is then OCR'd. |
| PNG / JPEG | OCR (tesseract.js, English, two passes). |

`positioned.ts` places words into lines, cells and table columns **by geometry alone**, and never edits a word. It handles:

- page skew;
- headings on two lines, in either order;
- tables continuing across pages, dropping repeated headings, page furniture and page numbers;
- wrapped transaction lines, joined to their transaction by left edge and vertical distance;
- rotated watermarks, which are skipped;
- low-confidence OCR marks, which are dropped.

Every such step is disclosed in the document's notes.

## Guarantees (deterministic gates, `lib/interpretation/gates.ts`)

A model **proposes** a layout and never supplies an amount. A document is accepted only when every gate passes on every row of the original:

- **Table:** structure, header and contiguous transaction lines.
- **Mapping:** integrity and heading agreement, checked against a bilingual (English/Malay) lexicon.
- **Dates:** every date parses, the day/month order is unambiguous, and the dates fall within the stated period.
- **Amounts:**
  - every amount parses under one number format;
  - direction tokens are fully covered;
  - split columns have exactly one side filled;
  - the running balance holds on every step.
- **Sign:** confirmed independently by vocabulary or by the running balance.
- **Record identity:** IDs are unique, and an evident ID column is adopted.
- **Role, ledger account and scope:** come from the document's own content, never the file name.
- **Canonical round trip:** the canonical form carries exactly the computed totals.
- **Extracted documents (PDF, OCR) additionally:**
  - transactions must be in date order;
  - an **arithmetic anchor** is required: the running balance, or the stated totals equal to money in and money out. A disagreeing stated total always fails.
- **OCR disputes:** a word the two passes read differently keeps the more confident reading. Only if the table then fails on figures may `verifyWithDisputes` try the alternatives, and only a single consistent choice is accepted and disclosed.

## Persistence

The ingestion store is the Supabase project **FinGence-Production**, schema `fingence_ingestion`, defined in `supabase/sql/ingestion-layer-v1.sql`:

- **Tables:**
  - `runs`: pipeline version, processing ID, scope, a keyed client hash, document count;
  - `documents`: file and table fingerprints, format, role, decision, reason, method, model receipt, mapping, checks, disclosures, notes, canonical SHA-256;
  - `records`: record ID, business, date, currency, signed cents, reference, description, counterparty.
- **Never stored:** the uploaded file.
- **Access:** RLS is enabled and forced with no policies, the schema is not exposed, and anonymous and authenticated roles have no access.
  - Writes and reads go through `public.fingence_ingestion_record_run(payload)` (atomic) and `public.fingence_ingestion_get_run(run)`, which only the service role may execute.
- **Route:** `POST /api/ingestion/runs` (same-origin, 1.5 MB bound, schema-validated by `runPayloadSchema`, rate-limited by the shared budget store) and `GET` for availability.
  - The route exists only when `FINGENCE_INGESTION_STORE=1`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) are set.
  - The Data page shows "Save verified records" when it is on.
  - With the workspace on (`FINGENCE_WORKSPACE=1`, see [workspace-roles.md](workspace-roles.md)), the route records runs for any signed-in member, automatically and for SAIC's organization, and refuses them while an Admin has paused processing. Without a session nothing is recorded.

## Evidence

`tests/document-ingestion/benchmark.test.ts` is opt-in and live; see `docs/integration/ingestion-benchmark.md` for how to run it and the measured results. The deterministic suites are:

- `tests/interpretation/*`: gates, workbook, extraction, OCR and disputes;
- `tests/document-ingestion/store.test.ts`: run payload and route.

## Limits

- **Language:** OCR is English only, at about 10 s per page in the browser.
- **Layout:** a footer typed directly under a table with no blank line is read as a table line and quarantines. Side-by-side tables on one page are not separated.
- **OCR'd text fields:** references and descriptions are only as good as the scan. A misread reference makes a reconciliation item to review; it never produces a silent match.
- **Scope:** one business, one cash account and one currency per document. Multi-currency and multi-account documents are quarantined.
- **Downstream rule:** the Phase 1 pipeline still passes one month in MYR to reconciliation. The [reconciliation layer](reconciliation-layer-v1.md) itself accepts several months and any one currency.
