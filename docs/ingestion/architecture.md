# Data Ingestion PoC v0.1 — provisional contract

## Integration authority and change policy

Implementation types/defaults/versions in [models.ts](../../lib/ingestion/models.ts), this document's semantic explanations and [executable tests](../../tests/ingestion/) are the current ingestion reference. The [team handoff](../handoff/TEAM_HANDOFF.md) and [AI context](../handoff/AI_CONTEXT.md) are orientation documents that link to these sources, not duplicate field/rule specifications.

Earlier academic planning documents may describe proposed signed-cash conventions, VALID-only publishing or persistence that predate this implementation. Preserve those formal submissions as historical project documentation; do not interpret them as implemented behavior. This PoC preserves source monetary representations, includes VALID/WARNING canonical records and has no backend persistence.

Default downstream input is `consolidate(results).normalized` or JSON `datasets[].normalized`. `datasets[].records` contains evidence/quarantine and is not the default analysis input. Keep envelope versions: isolated rows do not carry schema/ruleset context. Check all supplied result versions before consolidation or consumption, and JSON envelope/dataset versions before visiting rows. The [consumer recipe](../../examples/ingestion/consume.ts) demonstrates compatibility gating for trusted engine-produced results; it is not arbitrary JSON validation or a production API. The eventual smaller accepted-data transport and JSON Schema remain deferred pending Frederick/Celester agreement.

The UI generates session batch IDs; reusable-engine callers supply context. Backend batch/record ID ownership, transport and persistence require team confirmation. Source row IDs remain lineage coordinates, not economic uniqueness or database IDs.

Contract changes require a visible note naming affected fields/rules, reviewed examples and regression fixtures, and coordination with affected consumers before adoption:

- Removing/renaming fields or changing their meaning requires a schema-version change and consumer review.
- Changing parsing, validation or eligibility behavior requires a ruleset-version change; both versions may need to change.
- Presentation/documentation changes alone do not change contract versions.
- Consumers declare supported versions explicitly; do not silently auto-adopt changed semantics. This policy does not implement production migration or backward-compatibility machinery.

## Repository assessment and gap analysis

Inspection preceded implementation: Git state and tracked files, CodeGraph's repository graph, package/configuration files, route/component imports, existing types/mock data, and the Group/Individual Assignment folders were examined. The initial local/remote branch view contained `main`; no overlapping ingestion implementation was visible in that checkout. Work by teammates outside the visible checkout cannot be ruled out.

The repository already contained Next.js 16.3.3 App Router, React 19.2.8, strict TypeScript, Tailwind 4, ESLint, pnpm 11.19.0, `components/app-shell.tsx`, shared panels/overlays/charts, and mock routes. `app/data/page.tsx` simulated uploads and displayed mock sources. `lib/types.ts` and `lib/mock-data.ts` supported other prototype pages. There was no ingestion pipeline, API/backend, database, real parser, Streamlit app, test runner or committed ingestion fixtures.

| Requirement | Before | Decision for this increment |
| --- | --- | --- |
| Demo interface | Existing Next.js Data page | Reuse it and existing panels/drawer |
| Canonical model | Mock UI types only | Separate provisional transport types |
| Readers/profiling/mapping/validation | Simulated upload only | Pure reusable TypeScript engine |
| Raw/source evidence and quarantine | Absent | Keep parsed raw, staging and candidate beside outcomes |
| Consolidation/quality metrics | Mock summary | Calculate from processed rows |
| Tests and defensive fixtures | Absent | Vitest plus independent expected outcomes |
| Backend/storage/integrations | Absent; later project architecture discussed separately | Keep v0.1 local and in memory |

No Streamlit/Python stack was introduced because a suitable UI already existed. A future Python/API team can implement this versioned transport contract; this PoC does not decide their production architecture. Other pages, mock types, authentication/deployment/CI configuration and production database schemas are untouched.

## Modules and flow

```text
File bytes → inspection + SHA-256 → parsed RawSheet / RawRow
                 ↓ selected worksheet and header
         Dataset → profile → mapping suggestions
                 ↓ one user approval of mapping + source conventions
              staging values
                 ↓ strict parsing + technical issues + provisional business rules
         ProcessedRow {raw, staging, candidate, provenance, issues, status}
                 ├── REJECTED → inspectable quarantine
                 └── VALID / WARNING → canonical transactions
                                     ↓
                    consolidation + summary + CSV/JSON evidence
```

Raw, staging, validated, normalized and consolidated are conceptual stages. Separate database tables are unnecessary for an in-memory consultation prototype. Parsing and row validation cooperate so that a parse error becomes an inspectable issue rather than an unhandled conversion. Rejected candidates are never included in canonical output.

| File | Responsibility |
| --- | --- |
| `lib/ingestion/models.ts` | Contract, raw/staging/result/issue types, defaults, versions |
| `readers.ts` | UTF-8 CSV/XLSX reads, sanitized basename, hash, worksheet/header selection |
| `workbook-guard.ts` | Bounded ZIP/XML preflight and common unsupported workbook checks |
| `profiler.ts` | Counts, missing values, illustrative type inference, raw duplicates and previews |
| `mapper.ts` | Exact/alias/normalized matches, overrides, provenance and approval checks |
| `normalizer.ts` | Strict dates, decimal text, text/null normalization and exact subtraction |
| `normalize-record.ts` | Map staging values into a candidate; field-specific technical issues |
| `validator.ts` | Provisional business policies, warnings and required direction checks |
| `pipeline.ts` | Provenance, row classification, accepted output and replacement on reprocessing |
| `summary.ts` | Defined quality counts and denominators |
| `exports.ts` | Canonical CSV, rejected-issue CSV and versioned JSON evidence |
| `index.ts` | Reusable public entry point |
| `components/ingestion/*.tsx` | Profile, mapping/convention review, result tables and source inspector |
| `app/data/page.tsx` | Session orchestration, native upload, samples, invalidation and downloads |

Engine modules do not import React, Next.js or DOM UI APIs. The reader needs `Uint8Array`, `TextDecoder` and Web Crypto; tests exercise it in Node. A Node adapter can reuse the engine; a Python backend needs a corresponding implementation, not a direct import.

New dependencies are pinned: **papaparse 5.7.0** for CSV quoting/separators, **read-excel-file 9.3.10** for browser XLSX/date decoding with a raw numeric-text callback, and **fflate 0.8.3** for bounded archive inspection. **Vitest 4.1.11** and Papa types are development dependencies. The preflight expands archives once before the workbook parser expands them; the cost is acceptable within these prototype limits, but larger files need a worker/streaming design.

## Canonical transaction fields

Contract/envelope versions are `schema_version: "0.1"` and `ruleset_version: "0.1"`. These identify this implementation's assumptions, not client approval. Fields marked required must be present in accepted records. Money uses normalized base-10 strings: `"125.5"`, `"-20"`; JSON consumers must use decimal-safe arithmetic. Optional fields are present as null when absent/unparseable, with issues where appropriate.

| Field | Type | Required / behavior |
| --- | --- | --- |
| `source_system` | string | Required; explicit reviewed dataset label, trimmed |
| `source_file` | string | Required; basename, control characters removed, length bounded |
| `source_sheet` | string or null | Worksheet name; null for CSV |
| `source_row_number` | integer | Required; CSV logical record number or Excel worksheet row, header included |
| `source_row_id` | string | Required; SHA-256 + worksheet index + original row |
| `file_sha256` | 64-character hex string | Required; exact original byte-content fingerprint |
| `ingestion_batch_id` | string | Required; generated session batch ID |
| `ingested_at` | UTC ISO timestamp string | Required; strict known-offset input normalized to `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `transaction_date` | `YYYY-MM-DD` string or null | Original normalized source transaction date, independent of selected basis |
| `posting_date` | `YYYY-MM-DD` string or null | Original normalized source posting date, independent of selected basis |
| `canonical_date` | `YYYY-MM-DD` string | Required; valid date from the explicitly approved source selection |
| `canonical_date_basis` | `TRANSACTION_DATE` or `POSTING_DATE` | Required; identifies the source date used for canonical/downstream processing |
| `reference` | string or null | Optional; missing value warns; trim without numeric coercion |
| `source_transaction_id` | string or null | Optional original business identifier, distinct from generated row ID |
| `account_code`, `account_id`, `entity_id` | string or null | Optional; text leading zeros retained; numeric Excel identifiers warn |
| `description`, `counterparty` | string or null | Optional; trim; missing description warns |
| `monetary_basis` | enum | Required: `source_signed_amount`, `source_amount_with_direction`, `debit_credit` |
| `source_amount` | decimal string or null | Required for source-amount modes; preserve source sign or unsigned magnitude |
| `debit`, `credit` | decimal string or null | Both required in ledger mode; independent source sides |
| `entry_side` | `DEBIT`, `CREDIT` or null | Required for amount + direction; optional/derived in other modes |
| `derived_ledger_net` | decimal string or null | Ledger-only convenience: exact debit minus credit; never universal cash flow |
| `balance` | decimal string or null | Optional; invalid supplied value warns and becomes null |
| `currency` | string or null | Optional; uppercase; missing/malformed values warn; explicit approved default allowed |
| `currency_basis` | `SOURCE`, `DATASET_DEFAULT` or null | Source currency takes precedence; null when neither supplies a value |
| `transformations` | transformation array | Approved blank-side conversions: field, source column, original value, normalized `"0"`, rule `APPROVED_BLANK_SIDE_ZERO`; otherwise empty |
| `ingestion_status` | `VALID` or `WARNING` | Required in canonical output; rejected rows are outside this table |
| `validation_messages` | issue array | Required, empty for VALID; reason/category/field/rule/source column/original value for each issue |

Eligibility is **a valid selected date + a valid selected monetary representation + generated provenance**. No universal `amount` field is required. Account codes are not mandatory for bank statements. Selecting posting date never overwrites transaction date. For source dates `2026-09-01` and `2026-09-03`, selecting posting date retains those two dates and sets `canonical_date: "2026-09-03"`, `canonical_date_basis: "POSTING_DATE"`. The input option `dateBasis` selects a mapped source field; the output basis explicitly names its meaning.

Only one usable date is sufficient if that date is explicitly selected. A missing optional date remains null without a warning; an invalid supplied optional date becomes null with a warning and retained raw/staging evidence. Missing/invalid selected dates reject the row even if the other date is usable. An unmapped selected date blocks dataset approval/processing. There is no automatic fallback.

Examples: ledger debit `0`, credit `200` produces ledger net `-200` with null source amount. An unsigned bank amount `125.5` with `Debit` remains `125.5` plus `DEBIT`; no cash-outflow sign is invented. A signed bank amount `-20` stays `-20`. Consolidation unites the schema and provenance, not the economic meaning of these values.

## Mapping and normalization decisions

Exact canonical names score **1.00**, case-insensitive known aliases **0.95**, normalized canonical names **0.90**. Unknown columns remain unmapped. Manual overrides have method `manual` and null confidence; human review is not assigned a numerical certainty score. Scores are deterministic matching strengths, not calibrated probabilities. Target collisions block processing. All source columns, including intentionally ignored ones, are represented in mapping evidence with `userConfirmed`.

One approval action applies to each selected dataset and its conventions. Changing a mapping, source convention, header or effective CSV separator clears approval and removes that dataset's old output. A successful rerun replaces the prior same-file/same-sheet result. Reopening a processed dataset restores its approved header/settings. Multiple worksheets always require selection; no default first-sheet ingestion.

Text dates default to strict ISO. DMY/MDY accepts ISO as well as the explicitly selected order; no locale is guessed. Calendar validity is checked. Typed Excel dates use the decoded UTC calendar date; non-midnight values warn when time is removed. Decimal normalization validates the entire value, supports explicitly chosen grouping/decimal conventions and parentheses for negatives, removes insignificant zeros and never rounds. Excel stored numeric text bypasses locale grouping and supports bounded exponent expansion. Numeric input is bounded to 128 characters. No currency conversion occurs.

Ingestion timestamps are instants, separate from financial calendar dates. The engine accepts the RFC3339 subset `YYYY-MM-DDTHH:mm:ss[.S|.SS|.SSS](Z|±HH:mm)` with valid calendar/time components and a known offset. UTC output always includes three fractional digits. Offset inputs are converted to the same UTC instant in result context, row provenance, candidates and canonical records. Date-only/locale strings, missing timezones, rollover dates, hour 24, leap seconds, more than three fractional digits, unknown `-00:00` offsets and UTC years outside 0001–9999 are rejected. The UI continues generating `new Date().toISOString()`.

An approved currency default is used only when source currency is blank, with `currency_basis: "DATASET_DEFAULT"`; source values retain `SOURCE` even if malformed. Approved blank-side zero conversions create structured `transformations` without inventing a quality warning. Original cells remain unchanged; both-blank ledger rows remain rejected. These narrow records are visible in the inspector, canonical CSV and JSON evidence, not a comprehensive transformation audit system.

Whitespace-only values become null; literal `NA`, `N/A` or `null` strings are not silently interpreted as empty. Display previews are capped, while full parsed row evidence remains exportable. XLSX evidence is decoded cell values, not a reproduction of the original ZIP/XML/styles. Original byte buffers are not retained after parsing; keep source files separately if exact binary reconstruction is required.

## Validation and safe failure

| Condition | Default outcome |
| --- | --- |
| Unsupported extension, invalid UTF-8/CSV quoting, unreadable workbook, duplicate/empty header, empty dataset | File/dataset-level error; no canonical output; visible error message |
| Row cell count differs from selected header | REJECTED; all original cells remain inspectable |
| Missing/invalid selected date | REJECTED |
| Missing/invalid required monetary input | REJECTED |
| Blank ledger side | REJECTED unless blank-side-as-zero explicitly approved and opposite side populated |
| Both ledger sides blank | REJECTED even with blank-side-as-zero approved |
| Negative ledger debit/credit | WARNING; configurable warn/reject/allow |
| Both ledger sides nonzero | WARNING; configurable warn/reject/allow |
| Unsigned amount + direction lacks recognized direction or has negative magnitude | REJECTED under that explicitly chosen representation |
| Invalid optional date/number, numeric Excel identifier, time truncation | WARNING with original value retained |
| Missing reference/description/currency | WARNING; no guessed value |
| Malformed currency code | WARNING, supplied uppercase value retained |
| Exact repeated parsed raw row after its first occurrence | WARNING; retained, no automatic deletion |

Currency validation checks only `[A-Z]{3}` structure. A value such as `ZZZ` passes this structural test; authoritative ISO 4217 membership is not claimed. The two configurable ledger policies are provisional until source accounting conventions are confirmed. No balanced-journal, tax, reconciliation, future-date, account-chart or financial-accuracy rules are invented.

Limits: 10 MiB input, 50 MiB actual/declared expanded archive content, 1,000 archive entries, 10,000 data rows (worksheet coordinates up to row 10,001 including the header), 100 columns. Ordinary ZIP only; ZIP64/multi-volume/encrypted archives are unsupported. Preflight detects tested examples of formulas, workbook errors, macros, external workbook parts, XML declarations/entities, unsafe archive paths and oversized coordinates. These checks and library parsing are **not a comprehensive hostile-workbook or ZIP-bomb security guarantee**. Conservative rejection may exclude benign workbooks; export values-only data.

No uploaded values are logged by application code. React renders text rather than HTML. CSV text that begins with spreadsheet formula markers is prefixed with an apostrophe; valid canonical numeric fields keep their numeric sign. CSV consumers can still apply their own type coercion or lose leading zeros/precision; JSON evidence is the exact-value handoff. Downloaded evidence is sensitive when the input is sensitive. Browser extensions/OS retention and server access logs are outside this in-memory design's control.

## Summary definitions

`rowsReceived = valid + warning + rejected`; `accepted = valid + warning`. Only selected, processed datasets count; unreadable files have unknown row counts and appear separately as error attempts. Empty denominators display N/A.

| Metric | Definition |
| --- | --- |
| Files processed | Distinct file SHA-256 among current processed results |
| Datasets processed | Distinct processed file/sheet selections |
| Ingestion success | Accepted / received × 100 |
| Clean validity | VALID / received × 100 |
| Required-value completeness | Populated selected-date and selected-money groups / (2 × received) × 100 |
| Missing monetary input | Missing source amount, or missing amount/direction in direction mode, or missing required ledger side under selected blank-side policy |
| Duplicate raw rows | Extra occurrences beyond the first identical parsed cell array within each selected dataset |
| Missing dates/references | Empty selected-date/reference input, not malformed populated values |
| Unmapped / ignored columns | Source mappings with null target across processed datasets |

Completeness measures presence, including populated but malformed values. It is not validity or accuracy. Direction is part of the required money group in direction mode. A ledger's two sides form one group. Same economic transactions across different files are not detected as duplicates.

## Unresolved consultation decisions and smallest follow-up

Confirm source priority/formats, mandatory downstream keys, date basis/locales, debit/credit reversals and dual-sided rows, signed amounts versus direction, approved currency defaults/multi-currency, warning eligibility, mapping approval expectations, row traceability/retention, and later file/API integration. Safest defaults are explicit conventions, preserved source semantics, mandatory provenance, review before transformation, warnings for unconfirmed ledger policies, and session-only storage.

After feedback, implement **one approved source mapping profile** with client-confirmed required fields/conventions and a new ruleset version plus regression fixtures. Then agree the canonical handoff with the reconciliation/backend teammate. Do not begin forecasting, reconciliation or persistence before those decisions.
