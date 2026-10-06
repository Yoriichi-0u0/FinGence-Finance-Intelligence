# FinSight Prototype

COS40005 Project A, Sprint 1 — Topic 21: **Finance Intelligence: AI-Driven Financial Analysis and Automated Reporting**.

The **Data** page now runs a real, local **Data Ingestion PoC v0.1**: read CSV/XLSX, profile source values, review column mappings and conventions, validate rows, inspect warnings/rejections, normalize accepted records, consolidate compatible representations, and export evidence. The canonical schema is provisional and awaits client feedback.

Overview, Transactions, Reconciliation, Analytics, Forecasting, Anomalies and Reports remain the existing mock UI prototype. They do not consume uploaded data. There is no trained model, reconciliation engine, backend, database, authentication or production integration.

## Ingestion handoff and accepted-data contract

Start with the [teammate handoff](docs/handoff/TEAM_HANDOFF.md) or [AI context](docs/handoff/AI_CONTEXT.md), then the [tested consumer recipe](examples/ingestion/consume.ts). Default downstream input is `consolidate(results).normalized` or JSON `datasets[].normalized`: VALID/WARNING records, with warnings and lineage retained. `datasets[].records` also contains quarantine/evidence and is not the default analysis input.

**SYNTHETIC EXAMPLE · NOT CLIENT DATA · NOT A PRODUCTION API CONTRACT:** [engine-generated evidence JSON](docs/handoff/examples/ingestion-evidence.json). [Handoff tests](tests/ingestion/handoff.test.ts) verify it against the exporter and independent fixture expectations. It remains the full evidence export, not the future backend payload.

**C1 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 5 October 2026:** [accepted-data contract](docs/ingestion/accepted-data-contract.md), [public adapter](lib/ingestion/accepted-data.ts), [usage example](examples/ingestion/accepted-data.ts) and [tests](tests/ingestion/accepted-data.test.ts). `createAcceptedDataPayload(results)` groups accepted records under `datasets[].normalized`, with shared source/batch context and a small dataset quality summary. It pins schema/ruleset compatibility to `0.1`, changes no existing exports or UI, and adds no backend/network/persistence. It preserves caller batch IDs; the current UI still reuses one session ID on reprocessing. Fresh batch generation remains a later orchestration task. Inspect your checkout for availability; the checkpoint preceding C1 is `ingestion-ux-v0.1` (`59a4d30`).

## Run locally

Use the repository's pnpm package manager. Verification used **Node 25.8.1** and **pnpm 11.19.0**; a different Node version has not been verified for this increment. No Python environment or secrets are required.

```bash
cd finsight-prototype
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

If already inside this repository, omit `cd finsight-prototype`. Open [the ingestion demo](http://127.0.0.1:3000/data). A modern browser with Web Crypto is required; localhost is supported. For a local production-build demonstration:

```bash
pnpm build
pnpm start --hostname 127.0.0.1
```

Stop the development server before starting a second server on port 3000.

## Consultation demo

1. Click **Load ledger CSV** (or upload `public/samples/ingestion/ledger.csv`). Inspect its 10 rows and `posting_date / journal_id / debit / credit` columns.
2. Review the suggested mappings. Keep **Debit / credit** and **Canonical date source → Posting date**. Check the review box and click **Validate and normalize**: **10 VALID**.
3. Click **Load bank XLSX** (or upload `bank_statement.xlsx`). Choose **Transactions**, leaving the `Read me` sheet unprocessed. Its 8 rows use `Date / Details / Narration / Direction / Amount / Balance / Currency`.
4. Two source columns initially suggest `description`. Change **Details → reference**, keep **Narration → description**, and review **Unsigned amount + Debit/Credit direction**. Confirm and run: **8 VALID**.
5. Click **Load edge cases**, review the ignored `Unmapped Note`, confirm, and run: **2 VALID, 3 WARNING, 3 REJECTED**.
6. Select **REJECTED · 3**, then inspect source row **7**. The original `31/31/2026`, validation rule, raw cells, staging values, partial candidate and source metadata remain visible.
7. Show the consolidated summary: **3 files, 26 received, 20 valid, 3 warnings, 3 rejected, 23 accepted**. The output retains independent transaction/posting dates, explicit canonical date/basis, and separate source amount, debit, credit and ledger net fields.
8. Download **Canonical CSV**, **Rejected issues CSV** and **JSON evidence bundle**. Re-load a sample to show the duplicate-file warning; edit a mapping to show that approval/output are invalidated until reprocessing.

See [the detailed demo guide](docs/ingestion/demo.md) and [architecture, schema and metric definitions](docs/ingestion/architecture.md). Predetermined fixture expectations are in [expected.json](public/samples/ingestion/expected.json).

## Verification

```bash
pnpm test
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm audit --json
```

`next typegen` generates the Next.js route/layout types used by the existing layout, including `LayoutProps`. Run it before TypeScript in a fresh checkout without a build cache. The ordinary suite uses only repository synthetic fixtures. One integration test is skipped unless the external **supplied synthetic workbook** is explicitly selected:

```bash
FINSIGHT_WORKBOOK_PATH='../04 Modules/01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test
```

That file is not required for installation/demo and is not copied into this repository. Only `Transactions` is transformed; label and ground-truth sheets are not input transactions. [Verification evidence](docs/ingestion/verification.md) records actual commands, counts and manual checks.

## Data handling and boundaries

- Uploaded files are parsed in browser memory. No ingestion endpoint, upload POST, database write or persistent browser storage is implemented. Refresh, navigation away, or **Reset session** discards the session. Downloads deliberately save user-selected evidence locally and may contain financial data.
- Only synthetic consultation samples live in `public/`. Never place client uploads there or commit them. Original byte buffers are released after parsing; file hash, parsed source values, source coordinates, mapping and rules remain available in session/evidence.
- CSV must be UTF-8. Comma, semicolon and tab separators are supported; select a separator and re-upload the file to re-read it. Choose ISO, DMY or MDY explicitly for text dates and an explicit text number convention. Blank text becomes null; literal `NA` remains text.
- `transaction_date` and `posting_date` preserve independent source meanings. `canonical_date` uses the reviewed source, identified by `canonical_date_basis`; missing/invalid selected dates reject without fallback. Ingestion timestamps require a strict known-offset ISO instant and are stored in UTC with milliseconds. Currency defaults and approved blank-side conversions carry explicit provenance.
- The PoC accepts ordinary values-only XLSX. Input/expansion/entry/coordinate bounds and checks for common unsupported workbook constructs are implemented. This is a bounded prototype, not a comprehensive hostile-workbook security boundary.
- Money is exact decimal **text**, not JavaScript floating-point arithmetic. `derived_ledger_net = debit - credit` is a ledger convenience value. No universal cash-flow meaning, exchange-rate conversion or mixed-source financial total is inferred.
- Exact duplicate files are blocked within the session; repeated raw rows are warned and retained. Economic duplicates across ledger/bank sources require a future reconciliation layer.

This is **NOT the final production system**. Measured fixture outcomes demonstrate ingestion behavior; they do not establish accounting correctness on client files or model/reconciliation accuracy.
