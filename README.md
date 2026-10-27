# FinGence — current technical guidance

Run the application directly from your Git clone's root:

```sh
cd FinGence-Finance-Intelligence # or your chosen clone directory
pnpm install --frozen-lockfile
pnpm dev
```

Use Node 24.x and pnpm 11.19.0; local verification uses Node 24.22.0. See the
[current workspace instructions](docs/ai-ingestion/workspace.md) for offline OCR,
verification and private local material. No nested checkout is required.

Start with [the current team and AI technical entrypoint](docs/handoff/CURRENT.md).
It maps the stable C1/C2 exports, experimental V2 schemas/verifier, runtime requirements,
ownership, tested reuse examples and the missing V2-to-C1 bridge. It also includes a short
instruction block for coding assistants. [PR #4](https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence/pull/4)
tracks integration/CI; verify the deployed source SHA before claiming production availability.

The hosted Data page retains the verified deterministic ingestion → C1 → analytics path.
Use [FinGence](https://fingence-financeintelligence.vercel.app/) as the current product URL;
the former [FinSight-named address](https://finsight-financeintelligence.vercel.app/) remains
an alias for compatibility. Both belong to the same existing Vercel project.
V2 Increments 01–03B are source-available but their AI pages/APIs remain disabled in hosted
production. One genuine Groq proposal failed acceptance; 03B refinement has no new live
accuracy result. Experimental machine-verified records are not C1 or approved transactions.

## Historical status and release notes

The dated sections below preserve earlier implementation/release statements, including
superseded branch, review, deployment and integration status. Use CURRENT.md for today's
entrypoints and boundaries; linked source/contracts remain authoritative for field semantics.

# Historical: FinGence 2.0 — isolated local experiment, 20 October 2026

The `feature/v2-multimodal-ingestion` branch adds a local `/ai-ingestion` prototype, four-format extraction, declarative rule verification and reproducible evaluation. **Live OpenAI inference has not run:** secure destination confirmation was declined; no key was created. Recorded test proposals are explicitly labelled and are never the UI default. Start with the [local demo and implementation status](docs/ai-ingestion/README.md), [technology evaluation](docs/research/open-source-technology-evaluation.md) and [execution evidence](docs/ai-ingestion/verification.md). FinGence 1.0 ingestion, C1/C2 source contracts and production remain unchanged by this experiment. The sections below retain the earlier release documentation; use the dated V2 documents for this branch's experimental status.

# FinGence — SAIC integration candidate, 15 October 2026

The verified application candidate mirrors shared integration commit `b2b1f3b` without replacing personal Git history. See [current integration status, ownership and verification](docs/releases/saic-2026-10-16/README.md). Shared-main release remains gated on non-author team approval and passing checks; no production deployment is implied by this candidate. Historical ingestion verification and all C1/C2 checkpoints remain intact.

# FinGence — Finance Intelligence Prototype

![FinGence logo](public/branding/FinGence_Logo_96.png)

COS40005 Project A, Sprint 1 — Topic 21: **Finance Intelligence: AI-Driven Financial Analysis and Automated Reporting**.

**FinGence** combines **Finance + Intelligence**. The client is the **Sarawak Artificial Intelligence Centre (SAIC)**. The official academic project title above is unchanged.

The personal repository is [Yoriichi-0u0/FinGence-Finance-Intelligence](https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence). The existing [website](https://finsight-financeintelligence.vercel.app/) retains its assigned URL.

**FinGence Branding — IMPLEMENTED / INDEPENDENTLY REVIEWED — 12 October 2026**

The local branding implementation has passed review. Branding has not been deployed to production; the existing Vercel deployment remains on C2 until an authorized release. C1/C2 contracts and historical verification remain unchanged. The three modified synthetic files remain protected in the external backup and unapplied stash. No further Git-worktree or directory changes are required.

The **Data** page now runs a real, local **Data Ingestion PoC v0.1**: read CSV/XLSX, profile source values, review column mappings and conventions, validate rows, inspect warnings/rejections, normalize accepted records, consolidate compatible representations, and export evidence. The canonical schema is provisional and awaits client feedback.

Overview, Transactions, Reconciliation, Analytics, Forecasting, Anomalies and Reports remain the existing mock UI prototype. They do not consume uploaded data. There is no trained model, reconciliation engine, backend, database, authentication or production integration.

## Ingestion handoff and accepted-data contract

Start with the [teammate handoff](docs/handoff/TEAM_HANDOFF.md) or [AI context](docs/handoff/AI_CONTEXT.md), then the [tested consumer recipe](examples/ingestion/consume.ts). Default downstream input is `consolidate(results).normalized` or JSON `datasets[].normalized`: VALID/WARNING records, with warnings and lineage retained. `datasets[].records` also contains quarantine/evidence and is not the default analysis input.

**SYNTHETIC EXAMPLE · NOT CLIENT DATA · NOT A PRODUCTION API CONTRACT:** [engine-generated evidence JSON](docs/handoff/examples/ingestion-evidence.json). [Handoff tests](tests/ingestion/handoff.test.ts) verify it against the exporter and independent fixture expectations. It remains the full evidence export, not the future backend payload.

**C1 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 5 October 2026:** [accepted-data contract](docs/ingestion/accepted-data-contract.md), [public adapter](lib/ingestion/accepted-data.ts), [usage example](examples/ingestion/accepted-data.ts) and [tests](tests/ingestion/accepted-data.test.ts). `createAcceptedDataPayload(results)` groups accepted records under `datasets[].normalized`, with shared source/batch context and a small dataset quality summary. It pins schema/ruleset compatibility to `0.1`, changes no existing exports or UI, and adds no backend/network/persistence. It preserves caller batch IDs without generating ingestion context. Inspect your checkout for availability; the checkpoint preceding C1 is `ingestion-ux-v0.1` (`59a4d30`).

**C2 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 7 October 2026:** [`ingestDatasetRun`](lib/ingestion/run.ts) is the React-independent execution wrapper now used by the Data page. Each attempted execution requests a fresh UUID and UTC timestamp before calling the unchanged engine; only a returned result is stored, including a result whose rows are all rejected. Rechecking creates new context; reopening, inspecting, consolidating, projecting or downloading an existing result does not. Failed attempts may consume unused context and retries request another pair. The [lifecycle tests](tests/ingestion/ingestion-run.test.ts) cover these boundaries. C1 remains a pure projection; backend persistence/supersession is not implemented.

## Run locally

Use the repository's pnpm package manager. Verification used **Node 25.8.1** and **pnpm 11.19.0**; a different Node version has not been verified for this increment. No Python environment or secrets are required.

```bash
cd FinGence
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

If already inside this repository, omit `cd FinGence`. The local directory was previously named `finsight-prototype`; dated milestones, package/test identifiers and historical evidence retain their original names. Open [the ingestion demo](http://127.0.0.1:3000/data). A modern browser with Web Crypto is required; localhost is supported. For a local production-build demonstration:

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

## Current local development workspace — 26 October 2026

The development and Git root are the same directory. Stable and experimental source are in this single checkout. Read [workspace instructions](docs/ai-ingestion/workspace.md) for current paths and offline setup. Historical paths and dated verification remain execution evidence. Workspace consolidation does not deploy or authorize live LLM inference.

The 26 October V2 feature checkpoint, security synchronization, local isolation and secure Groq setup boundary are documented in [V2 publication readiness](docs/ai-ingestion/publication-2026-10-26.md). No genuine inference had executed at that checkpoint. The [27 October Increment 03B report](docs/ai-ingestion/increment-03/refinement-03b.md) records the first genuine request's acceptance failure and subsequent credential-free refinement. No additional inference or production release is implied.
