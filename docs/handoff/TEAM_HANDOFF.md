# FinGence ingestion — teammate handoff

**Default downstream input: accepted canonical records.**

| Route | Consume | Do not use by default |
| --- | --- | --- |
| Public TypeScript engine | `consolidate(results).normalized` | `results[].records` |
| Existing JSON evidence export | `datasets[].normalized` | `datasets[].records` |

`normalized` may contain **VALID and WARNING** records. Preserve warning messages and source lineage. `records` includes evidence, partial candidates and **REJECTED** rows; rejected rows must not be forwarded by default. Accepted means eligible under provisional ingestion rules, not confirmed accounting correctness or model readiness.

**C1 accepted-data route:** `createAcceptedDataPayload(results).datasets[].normalized`. This is a smaller, dataset-grouped projection of the same accepted input; keep its envelope and dataset context. See the [accepted-data contract](../ingestion/accepted-data-contract.md), [public adapter](../../lib/ingestion/accepted-data.ts) and [usage example](../../examples/ingestion/accepted-data.ts). The full JSON evidence export is not a production API payload.

## What is available

**CURRENT PRODUCT IDENTITY:** FinGence (Finance + Intelligence), for the Sarawak Artificial Intelligence Centre (SAIC). The personal repository is `Yoriichi-0u0/FinGence-Finance-Intelligence`, and the local directory is `FinGence`. Earlier FinSight names below identify historical milestones.

**FinGence Branding — IMPLEMENTED / INDEPENDENTLY REVIEWED — 12 October 2026**

The local branding implementation has passed review. Branding has not been deployed to production; the existing Vercel deployment remains on C2 until an authorized release. C1/C2 contracts and historical verification remain unchanged. The three modified synthetic files remain protected in the external backup and unapplied stash. No further Git-worktree or directory changes are required.

**IMPLEMENTED / AVAILABLE IN CURRENT WORKING TREE — checked 2 October 2026:** Chia's CSV/XLSX ingestion, profiling, deterministic column mapping, explicit review/approval, validation, normalization, quarantine, consolidation, quality metrics and exports. A1/A2 adds these handoffs and a tested consumption recipe; it does not change the engine or UI.

At this check, the PoC is an uncommitted local working tree on `feature/data-ingestion`. A branch name alone does not make these files available to another member. Inspect your actual checkout for `lib/ingestion/`, its tests and this example; publication/sharing needs a separate authorized step. This dated availability statement remains a historical snapshot after sharing.

**C1 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 5 October 2026:** pure accepted-data adapter/types, tests and example on `feature/ingestion-integration-contract`, starting from the committed `ingestion-ux-v0.1` checkpoint (`59a4d30`). It changes no canonical semantics, finance UI, existing exports or dependencies and implements no backend connection.

**C2 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 7 October 2026:** a small public execution wrapper now gives each Data-page check fresh batch/time context. The C1 projection, provisional financial rules and serializers are unchanged.

**PROVISIONAL:** canonical schema/ruleset versions `0.1`, client-dependent source conventions and the C1 transport projection. **FUTURE:** backend/database/API, AI/forecasting, reconciliation and dashboard integration. Other FinGence pages remain mock-driven. The Data page processes records in browser memory; refreshing/resetting/leaving discards the session. Downloads deliberately persist selected evidence locally.

## Start here

Use the [root README](../../README.md#run-locally) for install/run commands and the [demo guide](../ingestion/demo.md) for the existing consultation flow. Run `pnpm test tests/ingestion/handoff.test.ts` to exercise the handoff without the UI; use [verification](../ingestion/verification.md) for the full command set and measured outcomes.

The authoritative definitions are [implementation types/defaults/versions](../../lib/ingestion/models.ts), [architecture and financial/validation semantics](../ingestion/architecture.md), and [executable tests](../../tests/ingestion/). This document is orientation, not a second field/rule specification.

Earlier project planning documents may describe proposed architecture or data conventions that predate the current PoC, including a signed cash view, VALID-only publishing and persistence. For ingestion behavior, use the current source, architecture and tests. Formal university submissions are retained as historical project documentation and are not modified by this handoff.

## Consume our output

Use the [public entry point](../../lib/ingestion/index.ts) and [consumer recipe](../../examples/ingestion/consume.ts). The recipe checks **all supplied results** against supported schema/ruleset `0.1` before consolidation or any visitor callback. It then visits accepted records, preserves their complete values/messages, and returns version context, counts and lineage. It calculates no financial totals.

Node file adapters can pass `readFileSync(path)` directly to `inspectFile`. The reader owns a copy of exactly the supplied `Uint8Array` view, including sliced or pooled Node `Buffer` input, for hashing and CSV/XLSX parsing. Consumers do not need to make a manual copy. The [reader regressions](../../tests/ingestion/readers-buffer.test.ts) cover Buffer and ordinary Uint8Array views; the [handoff test](../../tests/ingestion/handoff.test.ts) checks each fixture fingerprint against independent Node SHA-256.

For the existing evidence JSON, check the envelope **and every dataset's** compatible versions before consuming `datasets[].normalized`. The TypeScript recipe accepts trusted engine-produced results; it is not an arbitrary JSON validator, authentication check or production API. C1 checks all result versions before consolidation and returns envelope versions plus dataset context, selected accepted fields/warnings/transformations and seven quality values. No raw/staging/candidate/mapping/options/rejected objects or ledger-derived net enter this projection. Warning/transformation original scalar values remain sensitive. A future external-input boundary needs independent validation/access control; JSON Schema and external transport versioning remain deferred.

For a new ingestion execution, use public [`ingestDatasetRun`](../../lib/ingestion/run.ts) after the existing mapping/convention approval. It requests one UUID/time pair per attempt; returned results preserve it, including all-rejected results. A throwing attempt returns no result and may consume unused context; retrying requests fresh context. For existing results, reuse them: reopening, inspecting, consolidating, projecting and exporting must not execute ingestion again. C1 preserves the supplied `ingestion_batch_id` and generates nothing. Direct `ingestDataset` callers still own their context. See the [lifecycle tests](../../tests/ingestion/ingestion-run.test.ts); backend supersession and changed-file replacement association remain downstream.

**SYNTHETIC EXAMPLE · NOT CLIENT DATA · NOT A PRODUCTION API CONTRACT:** [generated JSON evidence](examples/ingestion-evidence.json). It comes from the existing ledger, bank and edge fixtures, including Details → reference correction, with batch ID `synthetic-handoff-example-batch-001` and fixed UTC timestamp. The JSON is the real export plus a final newline, without disclaimer fields or overloaded IDs. It contains 26 processed records, 23 accepted (20 VALID / 3 WARNING), and 3 quarantined records.

Regenerate only after an intentional, reviewed example/contract change:

```bash
FINSIGHT_REGENERATE_HANDOFF_EXAMPLE=1 pnpm test tests/ingestion/handoff.test.ts
```

Ordinary tests verify the example without rewriting it. [handoff.test.ts](../../tests/ingestion/handoff.test.ts) checks visited IDs/statuses, zero callbacks on incompatible input, exact values, lineage and independent fixture expectations.

## Financial cautions and ownership

- Preserve decimal and identifier strings; do not coerce money to JavaScript `Number` or strip identifier zeros.
- Source transaction/posting dates retain independent meanings; use the explicitly selected canonical date without inventing fallback.
- Preserve each monetary representation. Ledger net is a convenience calculation, not universal cash flow. Do not infer universal debit/outflow or credit/inflow, sum ledger and bank representations, or convert currencies.
- Source row IDs identify file/sheet/row lineage, not backend IDs or economic uniqueness. Repeated raw rows can remain accepted with warnings; cross-file economic duplicates need later reconciliation.
- The example visitor is synchronous/read-only by convention. Consumer errors are not rolled back; version preflight does not promise transactional publishing.

| Member | Our boundary provides | Confirmed ownership / remaining work |
| --- | --- | --- |
| Chia | Ingestion/structural consolidation, accepted records, lineage and evidence | Own ingestion batch identity and fresh-run orchestration; maintain projection/tests |
| Frederick | Normalized financial values, warnings and lineage | Own AI interpretation, aggregation/features and analysis-specific warning eligibility; do not reparse files |
| Celester | Accepted projection, caller batch identity and quality metadata | Own API/persistence, permanent database IDs, lifecycle/supersession, reconciliation and dashboard-ready summaries |
| Jason | PoC file controls and documented sensitive-data limits | Own production trust-boundary, backend validation, access-control/RBAC and audit requirements |
| Izzat | Internal statuses, quality/source metadata through the future backend | Own dashboard/API visualization, warnings and source drill-down; no ingestion React coupling |

These ownership decisions are the confirmed requirements supplied for C1. VALID/WARNING follow the accepted path; source-row IDs remain lineage; rejected/raw evidence remains separate. **Consolidation is not reconciliation.** No model-eligibility flags or permanent backend IDs are added.

**REQUIRES TEAM CONFIRMATION:** external transport versioning, backend batch scope, changed-file replacement association and evidence retention/retrieval details. **REQUIRES CLIENT CONFIRMATION:** mandatory accounting fields, date/number/source conventions, currencies, ledger exceptions and retention. Production backend validation/access control and action/ID-only audit logs remain future requirements; browser checks do not establish a production trust boundary. Follow the [contract-change policy](../ingestion/architecture.md#integration-authority-and-change-policy); do not silently change shared meaning or implement another member's layer.
