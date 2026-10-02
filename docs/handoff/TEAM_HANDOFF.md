# FinSight ingestion — teammate handoff

**Default downstream input: accepted canonical records.**

| Route | Consume | Do not use by default |
| --- | --- | --- |
| Public TypeScript engine | `consolidate(results).normalized` | `results[].records` |
| Existing JSON evidence export | `datasets[].normalized` | `datasets[].records` |

`normalized` may contain **VALID and WARNING** records. Preserve warning messages and source lineage. `records` includes evidence, partial candidates and **REJECTED** rows; rejected rows must not be forwarded by default. Accepted means eligible under provisional ingestion rules, not confirmed accounting correctness or model readiness.

## What is available

**IMPLEMENTED / AVAILABLE IN CURRENT WORKING TREE — checked 2 October 2026:** Chia's CSV/XLSX ingestion, profiling, deterministic column mapping, explicit review/approval, validation, normalization, quarantine, consolidation, quality metrics and exports. A1/A2 adds these handoffs and a tested consumption recipe; it does not change the engine or UI.

At this check, the PoC is an uncommitted local working tree on `feature/data-ingestion`. A branch name alone does not make these files available to another member. Inspect your actual checkout for `lib/ingestion/`, its tests and this example; publication/sharing needs a separate authorized step. This dated availability statement remains a historical snapshot after sharing.

**PROVISIONAL:** schema/ruleset versions `0.1`, source conventions and downstream requirements. **FUTURE:** backend/database/API, AI/forecasting, reconciliation and dashboard integration. Other FinSight pages remain mock-driven. The Data page processes records in browser memory; refreshing/resetting/leaving discards the session. Downloads deliberately persist selected evidence locally.

## Start here

Use the [root README](../../README.md#run-locally) for install/run commands and the [demo guide](../ingestion/demo.md) for the existing consultation flow. Run `pnpm test tests/ingestion/handoff.test.ts` to exercise the handoff without the UI; use [verification](../ingestion/verification.md) for the full command set and measured outcomes.

The authoritative definitions are [implementation types/defaults/versions](../../lib/ingestion/models.ts), [architecture and financial/validation semantics](../ingestion/architecture.md), and [executable tests](../../tests/ingestion/). This document is orientation, not a second field/rule specification.

Earlier project planning documents may describe proposed architecture or data conventions that predate the current PoC, including a signed cash view, VALID-only publishing and persistence. For ingestion behavior, use the current source, architecture and tests. Formal university submissions are retained as historical project documentation and are not modified by this handoff.

## Consume our output

Use the [public entry point](../../lib/ingestion/index.ts) and [consumer recipe](../../examples/ingestion/consume.ts). The recipe checks **all supplied results** against supported schema/ruleset `0.1` before consolidation or any visitor callback. It then visits accepted records, preserves their complete values/messages, and returns version context, counts and lineage. It calculates no financial totals.

Node file adapters can pass `readFileSync(path)` directly to `inspectFile`. The reader owns a copy of exactly the supplied `Uint8Array` view, including sliced or pooled Node `Buffer` input, for hashing and CSV/XLSX parsing. Consumers do not need to make a manual copy. The [reader regressions](../../tests/ingestion/readers-buffer.test.ts) cover Buffer and ordinary Uint8Array views; the [handoff test](../../tests/ingestion/handoff.test.ts) checks each fixture fingerprint against independent Node SHA-256.

For JSON, check the envelope **and every dataset's** compatible versions before consuming `datasets[].normalized`. The TypeScript recipe accepts trusted engine-produced results; it is not an arbitrary JSON validator, authentication check or production API. A future external-input boundary needs separate validation. JSON Schema is deferred until Frederick/Celester agree the smaller accepted-data transport.

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

| Member | Our boundary provides | Next agreement |
| --- | --- | --- |
| Chia | Ingestion/consolidation engine, accepted records and evidence | Maintain contract/tests and coordinate changes |
| Frederick | Accepted transaction input, warnings and lineage | Model inputs, aggregation and warning eligibility |
| Celester | Versioned results, metadata and evidence | Transport, persistent IDs, API/storage and retention |
| Jason | Implemented file checks and documented data-handling limits | Production trust boundary and server validation |
| Izzat | Status counts, defined quality metrics and source links | Backend view models/dashboard consumption |

**REQUIRES TEAM CONFIRMATION:** transport, backend batch/record ID ownership, persistence, warning policies and downstream keys. **REQUIRES CLIENT CONFIRMATION:** mandatory accounting fields, date/number/source conventions, currencies, ledger exceptions and retention. Follow the [contract-change policy](../ingestion/architecture.md#integration-authority-and-change-policy); do not silently change shared meaning or implement another member's layer.
