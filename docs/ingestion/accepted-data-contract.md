# C1 — accepted-data integration contract

**IMPLEMENTED / INDEPENDENTLY REVIEWED — 5 October 2026.** This is a provisional, local transport projection for trusted ingestion output. It is not a production API or backend integration. The starting checkpoint is `ingestion-ux-v0.1` (`59a4d30`); this increment is on `feature/ingestion-integration-contract`. Inspect your checkout rather than assuming another repository contains it.

The authoritative transport types and projection are [accepted-data.ts](../../lib/ingestion/accepted-data.ts), exported through [index.ts](../../lib/ingestion/index.ts). Canonical meanings remain defined by [models.ts](../../lib/ingestion/models.ts), [architecture](architecture.md) and the existing engine tests. This document specifies the selected transport boundary, not a second accounting schema. Client confirmation of mandatory fields and financial conventions remains necessary.

## Consumption boundary

```ts
import { createAcceptedDataPayload } from "../../lib/ingestion/index";

const payload = createAcceptedDataPayload(results);
// Accepted input: payload.datasets[].normalized — VALID + WARNING only.
```

The adapter calls the existing `consolidate(results)` and projects its retained per-dataset `normalized` arrays. Flattening those arrays gives exactly the membership/order of `consolidate(results).normalized`. It does not implement a second replacement algorithm or select accepted rows from `records`.

The full evidence JSON export remains unchanged. `datasets[].records` in that export includes rejected rows, raw/staging/candidate material and audit evidence. It is not the normal accepted-data input. The existing [consumer recipe](../../examples/ingestion/consume.ts) remains supported; the new [accepted-data example](../../examples/ingestion/accepted-data.ts) demonstrates the projection and reconstruction of lineage without React, network or persistence.

## Shape and required-value conventions

```text
AcceptedDataPayload
  schema_version
  ruleset_version
  datasets[]
    dataset_id
    source_system / source_file / source_sheet / file_sha256
    ingestion_batch_id / ingested_at
    normalized[] — accepted transaction projection
    summary — seven dataset quality values
```

Every defined property is emitted. An optional source value is represented by `null`, never by unpredictable property omission. Empty warning/transformation arrays remain arrays. An all-rejected processed dataset retains its metadata and summary with `normalized: []`. Empty input returns the supported version context with `datasets: []`, without inventing a batch.

Shared metadata appears once per dataset. A record's complete source provenance is reconstructed from those six shared fields plus `source_row_number` and `source_row_id`. This is an intentional projection: transport rows alone are not complete `CanonicalTransaction` objects. Keep the dataset/envelope context when passing them downstream.

### Envelope and shared dataset metadata

| Field | Source | Required / purpose |
| --- | --- | --- |
| `schema_version` | Every supplied result's checked version | REQUIRED; current supported value `0.1` |
| `ruleset_version` | Every supplied result's checked version | REQUIRED; current supported value `0.1` |
| `datasets` | `consolidate(results).results` | REQUIRED array; preserves existing retained dataset order |
| `dataset_id` | `result.dataset.id` | REQUIRED; source file/worksheet selection identity |
| `source_system` | The engine's reviewed `options.sourceSystem.trim()` label | REQUIRED; same meaning as canonical provenance, including all-rejected datasets |
| `source_file` | `result.dataset.file.name` | REQUIRED; existing filename value copied exactly; C1 applies no filename normalization |
| `source_sheet` | `result.dataset.sheet.name` | REQUIRED property; worksheet name or `null` for CSV |
| `file_sha256` | `result.dataset.file.fingerprint` | REQUIRED; original byte fingerprint, not economic uniqueness |
| `ingestion_batch_id` | `result.context.batchId` | REQUIRED; caller-supplied value preserved exactly |
| `ingested_at` | `result.context.ingestedAt` | REQUIRED; already engine-normalized UTC ISO timestamp copied unchanged |
| `normalized` | Each retained result's accepted array | REQUIRED array; VALID/WARNING only |
| `summary` | Explicit projection of `result.summary` | REQUIRED; quality metadata separate from transaction attributes |

### Accepted transaction projection

All values below come from the corresponding `CanonicalTransaction` field. No amount/date/identifier is reparsed or calculated by C1.

| Field | Type | Classification / meaning |
| --- | --- | --- |
| `source_row_number` | number | REQUIRED; original CSV logical record or XLSX row coordinate |
| `source_row_id` | string | REQUIRED; source lineage, not a database ID |
| `transaction_date` | string or null | OPTIONAL source date; independent normalized transaction date |
| `posting_date` | string or null | OPTIONAL source date; independent normalized posting date |
| `canonical_date` | string | REQUIRED; explicitly reviewed date used for these records |
| `canonical_date_basis` | `TRANSACTION_DATE` / `POSTING_DATE` | REQUIRED; no silent fallback |
| `reference` | string or null | OPTIONAL; exact normalized reference text |
| `source_transaction_id` | string or null | OPTIONAL; source identifier, not a permanent backend ID |
| `account_code` | string or null | OPTIONAL; source accounting code |
| `account_id` | string or null | OPTIONAL; already-mapped source account identifier |
| `entity_id` | string or null | OPTIONAL; already-mapped source entity identifier |
| `description` | string or null | OPTIONAL; source description |
| `counterparty` | string or null | OPTIONAL; available source context |
| `debit` | decimal string or null | OPTIONAL overall; required for the applicable ledger representation |
| `credit` | decimal string or null | OPTIONAL overall; required for the applicable ledger representation |
| `source_amount` | decimal string or null | OPTIONAL overall; required for the applicable amount representation |
| `balance` | decimal string or null | OPTIONAL; source balance, never calculated here |
| `entry_side` | `DEBIT` / `CREDIT` / null | OPTIONAL overall; required for amount-with-direction representation |
| `monetary_basis` | Existing three-value enum | REQUIRED; retain signed amount, amount-with-direction and debit/credit meanings separately |
| `currency` | string or null | OPTIONAL; preserve supplied/default value without conversion |
| `currency_basis` | `SOURCE` / `DATASET_DEFAULT` / null | REQUIRED property; preserve currency origin |
| `ingestion_status` | `VALID` / `WARNING` | REQUIRED; finance labels are presentation only |
| `validation_messages` | accepted warning array | REQUIRED; all accepted warnings retained |
| `transformations` | existing transformation array | REQUIRED; preserve explicit approved blank-side changes |

Monetary/identifier strings, signs and leading zeros remain unchanged. C1 does not clear extra mapped financial fields because a different monetary representation is primary. No universal `amount`, cash-flow direction, currency conversion or financial total is introduced. `derived_ledger_net` is deliberately excluded; it remains ledger-specific in canonical output/evidence.

### Warning and transformation values

| Nested field | Classification / purpose |
| --- | --- |
| `validation_messages[].rule` | REQUIRED; existing machine-readable rule string, including unfamiliar rules |
| `.category` | REQUIRED; existing technical/business category |
| `.severity` | REQUIRED; `WARNING` only in accepted output |
| `.field` | REQUIRED; affected field or whole-record issue |
| `.sourceColumn` | REQUIRED property; source column or null |
| `.originalValue` | REQUIRED; existing scalar source value or null, needed when a failed optional value becomes null |
| `.message` | REQUIRED; existing explanation copied exactly |
| `transformations[].field` | REQUIRED; affected debit/credit field |
| `.source_column` | REQUIRED property; original column or null |
| `.original_value` | REQUIRED; original blank/null/whitespace scalar |
| `.normalized_value` | REQUIRED; current approved transformation produces string `0` |
| `.rule` | REQUIRED; current rule is `APPROVED_BLANK_SIDE_ZERO` |

Original values retain the existing `RawCell` type, including typed Excel scalar `{kind, value}` objects. Only these selected scalar values are retained, not complete raw rows or parser evidence. They and warning messages can contain sensitive information. Currency origin uses the existing `currency_basis`; no invented currency-transformation object is added.

### Dataset summary

The seven selected fields are copied from the existing authoritative summary, without recalculating a competing definition.

| Field | Classification / definition |
| --- | --- |
| `rowsReceived` | REQUIRED; selected dataset's processed rows |
| `accepted` | REQUIRED; VALID + WARNING |
| `valid` | REQUIRED; VALID count |
| `warning` | REQUIRED; WARNING count, still included |
| `rejected` | REQUIRED; excluded count, without excluded transaction contents |
| `requiredCompleteness` | REQUIRED property; existing percentage or null; presence of selected date/money groups, including malformed populated values |
| `duplicateRows` | REQUIRED; extra identical parsed source rows, not economic duplicates |

The backend can derive success and clean-validity rates, dataset/file counts and dashboard views. Accepted rows alone cannot recover received/rejected counts, presence-based completeness or raw duplicate counts. These client-produced summary values are declarations, not trusted server audit facts; future backend validation must check externally received data. No quality measure is called accuracy, and no financial totals are calculated.

## Excluded evidence and downstream responsibilities

**AUDIT-ONLY / NOT IN ACCEPTED PAYLOAD:** rejected records/issues; raw cell arrays; staging/candidates; mapping methods/scores/confirmation; full options; profile/inferred types/previews/duplicate coordinates; header/column/separator/file-size/worksheet-index metadata; and per-row completeness bookkeeping. Their existing evidence export is unchanged.

**NOT IN INITIAL ACCEPTED PAYLOAD:** `derived_ledger_net`; missing-date/money/reference and unmapped-column counts; derived file/dataset counts and success/clean-validity rates. The selected counts/context support backend derivation of the latter. No backend IDs, reconciliation IDs, supersession pointers, AI eligibility flags or additional evidence wrappers are fabricated.

The payload does not reconstruct every approved parser setting or exception policy. Acceptance remains eligibility under the provisional ingestion rules and reviewed options, not accounting correctness, authoritative currency membership, server approval or readiness for a particular model.

| Owner | Confirmed responsibility |
| --- | --- |
| Chia | Parsing/profiling, reviewed mapping, validation/normalization, structural consolidation, lineage/provenance and ingestion batch identity |
| Celester | Backend/API, persistence, permanent database IDs, batch lifecycle/supersession, reconciliation and dashboard-ready summaries |
| Frederick | Normalized-input consumption, analysis-specific warning eligibility, interpretation, aggregation/features, forecasting and insights |
| Jason | Production trust boundary, access-control/RBAC recommendations, retention/audit/security requirements |
| Izzat | Dashboard/API consumption and visualization, including warning indicators and source drill-down |

**Consolidation is not reconciliation.** Source row IDs are lineage coordinates, not economic uniqueness. `account_id`, `entity_id` and `source_transaction_id` are retained source identifiers, not newly assigned backend transaction IDs. AI does not reparse files; dashboards do not depend on ingestion React components. WARNING remains accepted; analysis-specific eligibility belongs to Frederick.

## Compatibility, purity and internal consistency

The adapter explicitly pins supported schema/ruleset values to `0.1`, independently of future producer constants. It checks **every supplied result before consolidation or accepted-record access**, including inputs that will later be replaced. Unsupported versions fail the whole call. No new transport version is created in C1.

The adapter delegates retained-result selection/order entirely to `consolidate()`. Its output is a current consolidated snapshot, not batch history or a transactional publishing operation. It performs no network, storage, ID/timestamp generation, financial calculation or accounting interpretation. It explicitly copies selected fields and returns detached arrays/objects, including typed warning/transformation scalars. Repeating the call with the same input gives the same values.

Small producer-invariant assertions refuse a rejected normalized status, a rejection issue inside accepted output, or mismatched shared row/dataset provenance. They do not repair, filter, reclassify or validate arbitrary external input. TypeScript types do not provide runtime JSON validation. A future backend must independently validate externally received payloads and enforce access control.

Before external API publication, agree a separate transport version so envelope/projection changes need not imply changed canonical meanings. Canonical field meaning/type changes require schema review; parsing/validation/eligibility changes require ruleset review; presentation/documentation alone require neither. See the [change policy](architecture.md#integration-authority-and-change-policy).

## Batch/reprocessing lifecycle and future decisions

**C2 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 7 October 2026:** the Data page now calls [`ingestDatasetRun`](../../lib/ingestion/run.ts) for each attempted execution. Its production defaults request a fresh UUID and a UTC timestamp before calling the unchanged engine. A successful return, even with every row rejected, preserves that context; the UI stores only returned results. A failed attempt may consume unused context and a retry requests a new pair. Reopening, projecting, inspecting or downloading an existing result creates no new batch. This resolves the Data page's former session-ID reuse; it does not implement backend persistence or supersession.

The low-level engine still accepts caller context. C1 copies that context exactly and generates no IDs/timestamps. Callers using the low-level API remain responsible for fresh execution context; the projection must not substitute IDs to compensate for a caller reusing them.

If a caller already supplies batch B for the same dataset, the existing consolidation boundary retains that latest supplied result and C1 preserves B. It does not infer chronology from timestamps or expose a fabricated supersession pointer. The caller's batch ID is not documentation text and must never be repurposed.

Dataset identity is currently exact file hash plus worksheet index; source-row identity adds the original row coordinate. A changed file therefore has a different dataset ID. Backend logical-source replacement association and single-dataset versus multi-dataset batch scope still need definition. Never infer replacement from filenames. Separate evidence retention/retrieval and external transport versioning also remain future integration decisions.

**REQUIRES CLIENT CONFIRMATION:** actual source conventions, mandatory accounting fields/keys, selected date and text-number/date conventions, currencies/defaults, ledger exceptions and retention requirements. Confirmed team ownership does not invent client feedback.

Production backend validation, upload/view/evidence/download access controls, RBAC and action/ID-based audit logging remain future requirements, not implemented controls. Uploaded files and reports are sensitive; raw files should be temporary. Malware scanning is optional for the current FYP scope. Do not log full payloads/transactions. Other FinGence pages remain mock-driven, and C1 adds no persistence or API.

## Executable evidence

[accepted-data.test.ts](../../tests/ingestion/accepted-data.test.ts) exercises the public entry point and [usage example](../../examples/ingestion/accepted-data.ts) against controlled fixtures. **SYNTHETIC EXAMPLES / NOT CLIENT DATA / NOT A PRODUCTION API CONTRACT.** The controlled baseline is 26 processed rows, 23 accepted transport rows (20 VALID + 3 WARNING), zero rejected rows forwarded and three rejected rows counted separately. Existing CSV/evidence exports remain unchanged.

```bash
pnpm test tests/ingestion/accepted-data.test.ts
```

Full executed results and review-package instructions are appended to [verification.md](verification.md). Do not regenerate existing evidence fixtures for this projection-only increment.
