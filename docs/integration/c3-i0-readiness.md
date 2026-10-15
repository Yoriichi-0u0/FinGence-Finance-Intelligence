# C3-I0 — ingestion integration readiness

**C3-I0 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 13 October 2026** No C1/C2 source transfer, backend grouping, analytics adapter, database migration, or shared-branch update is performed by this increment.

**Published producer checkpoint:** `Yoriichi-0u0/FinGence-Finance-Intelligence`, tag `fingence-branding-v0.1`, commit `2ddcb7264a77c5467de3e311c3736be8d29a0d00`. C1 and C2 are implemented and independently reviewed at that checkpoint. Schema/ruleset remain `0.1`.

The portable [manifest](c3-i0-manifest.json) pins published source bytes, transfer actions, dependencies, and controlled fixture outcomes. Its hashes describe that committed checkpoint, including the example before its explicitly listed comment correction. It does not label these new readiness materials as published. Financial meanings remain authoritative in [models](../../lib/ingestion/models.ts), [the C1 contract](../ingestion/accepted-data-contract.md), and existing tests. This guide supplements historical documents with the confirmed C3 decisions; it does not replace their execution evidence.

## Implemented producer interfaces

Import through [the public ingestion entry point](../../lib/ingestion/index.ts), independently of React:

```ts
ingestDatasetRun(
  dataset: Dataset,
  mapping: readonly ColumnMapping[],
  options: IngestionOptions,
  providers?: IngestionRunProviders,
): IngestionResult;

createAcceptedDataPayload(
  results: readonly IngestionResult[],
): AcceptedDataPayload;
```

- **C2:** [ingestDatasetRun](../../lib/ingestion/run.ts) obtains a UUID/time pair for each attempted execution reaching the wrapper, then delegates to the existing engine. Returned results, including all-rejected results, preserve that context. A thrown attempt returns no result and may consume unused context; a retry obtains another pair. Injected ID providers must supply fresh IDs.
- **C1:** [createAcceptedDataPayload](../../lib/ingestion/accepted-data.ts) preserves producer context. It generates no IDs or timestamps, performs no financial arithmetic, and preflights every supplied schema/ruleset against explicitly supported `0.1` before accepted-record access. It delegates retained-dataset selection to existing `consolidate(results).results`; it does not reimplement replacement semantics.
- Inspection, reopening, consolidation, projection, and downloading existing results are not ingestion executions and must not request new context.
- The accepted transport is `payload.datasets[].normalized`, together with its envelope and shared dataset metadata. **VALID and WARNING are accepted; REJECTED is excluded.** These projected rows are not standalone full `CanonicalTransaction` objects.
- Keep monetary values as exact decimal strings and identifiers as strings, including leading zeros. Preserve the independent transaction/posting dates and explicit canonical date/basis. Keep all three monetary bases distinct.
- Dataset context retains filename, worksheet, file fingerprint, producer batch ID, and timestamp. Rows retain source row ID/number. C1 copies the existing filename value; it does not add filename normalization.
- Preserve warning messages and their limited original scalar values, currency origin, and approved blank-side transformation evidence. Full raw rows, staging, candidates, parser/mapping/options evidence, rejected records, and `derived_ledger_net` remain outside C1.

`source_row_id` is lineage, `ingestion_batch_id` is producer execution identity, and future backend attempt/database/reconciliation IDs have separate meanings. Consolidation is structural combination, not reconciliation.

## Selective integration and compatibility gates

The approved read-only planning inspection pinned these target snapshots; they are **not a claim that today's remote branches are unchanged**:

| Owner/source branch | Inspected commit |
| --- | --- |
| Celester — `features/backend-celester` | `8e08dfc1391c442d7dbeaa0f571758d06c88bcc5` |
| Frederick — `feature/analysis-reconciliation-fred` | `6f536e5f0e3be07b588fe995d7f7c15b70acb1e8` |
| Chia — `feature/data-ingestion-chia` | `161b489d2758160f46d6f8252dc866b595102735` |

Those inspected trees already contain compatible core ingestion files. They lack C1/C2 modules and their public exports. The backend CSV fixtures have LF bytes rather than the published CRLF bytes. Recheck these observations with the owners before a future authorized integration; do not overwrite a changed file based on this snapshot.

Proposed procedure for a separately authorized integration branch:

1. Record the target commit and clean/dirty state; confirm owner changes since the inspected heads.
2. Verify the manifest's eleven `VERIFY_REUSE` engine dependencies. Reuse existing files; stop for technical review if a required file differs. Do not wholesale merge the personal prototype, copy its UI, or replace target configuration.
3. Add the two published modules, two unchanged regression suites, and C1 contract document using `COPY_EXACT_IF_ABSENT`. Reuse byte-identical files if already present; review conflicting files with their owner.
4. Preserve the target `lib/ingestion/index.ts` and add only missing exports listed in `deliberate_edits.public_exports`. The source barrel hash is a reference, not a replacement instruction.
5. Copy the public-entry-point example with the listed **comment-only** correction. Its final bytes intentionally differ from the published source hash; imports, function signature, values, and behavior must remain identical.
6. Verify the four exact fixture sizes/hashes. Do not substitute Celester's newline-normalized copies or silently regenerate them. Resolve any mismatch explicitly before running cross-module tests.
7. After review, carry these readiness documents and fixture guard as a separate additive change. They are not source entries at the published checkpoint.
8. Run compatibility checks below and the owner-specific test suites. Stop at each owner review gate before connecting modules.

Any future shared Data-page adoption of C2 should be a narrow orchestration patch: use `ingestDatasetRun` at the existing approved processing action, remove obsolete session batch state/reset handling, and key result inspection by execution identity. Do not copy the personal B1/B2 page over teammates' UI. **That patch is not implemented by C3-I0.**

| Gate | Existing producer / inspected target | Future owner action |
| --- | --- | --- |
| Models and versions | Producer schema/ruleset `0.1`; inspected core models match | Pin consumer compatibility deliberately; no automatic adoption of future versions |
| Runtime dependencies | Existing `fflate 0.8.3`, `papaparse 5.7.0`, `read-excel-file 9.3.10`; C1/C2 add none | Verify target lockfile resolves the required existing imports |
| Runtime features | Exact decimal helper uses BigInt; C2 defaults use Web Crypto UUID and Date | Verify actual consumer runtime; injected providers do not supply security controls |
| TypeScript | Producer builds at ES2017 using BigInt constructors; inspected analytics uses BigInt literals | Frederick must verify ES2020 target or review an equivalent syntax change separately; no configuration change here |
| Test discovery | Existing include is `tests/ingestion/**/*.test.ts` and discovers this guard | Inspected `tests/analytics.test.ts` is outside that include; Frederick must prove discovery before adapter work |
| Trust boundary | C1 operates on trusted engine output, not arbitrary JSON | Celester/Jason must independently validate and authorize externally received data |

The planning compile probe found twelve `TS2737` errors for the isolated analytics snapshot at ES2017 and none at ES2020. This is historical probe evidence, not a claim that the shared application builds or that its configuration has been fixed.

## Confirmed backend requirements — proposed implementation

**Owner: Celester. Not implemented here.** One persistence attempt accepts multiple retained datasets, including distinct filenames and producer batch IDs, atomically.

Recommended additive boundary: a backend-owned `persistence_attempts` parent and one dataset-specific batch child per payload dataset. The parent carries its unique attempt ID and group counts/outcome; children carry `dataset_id`, producer `ingestion_batch_id`, source metadata, versions, and each existing dataset summary. Child financial records have backend-owned permanent IDs and retain source lineage. None of these backend IDs replaces a producer/source ID.

Create or reserve the attempt ID **before beginning the transaction** and keep it available to the caller on failure or uncertain COMMIT. The owner must decide how durable reservation/outcome investigation is implemented; do not assume a transaction-created parent will remain visible after rollback.

Required behavior:

- Validate the complete supplied group before writing. Reject duplicate dataset entries explicitly; do not invoke ingestion consolidation or silently apply latest-result-wins during persistence validation. Legitimate repeated source rows with distinct row coordinates must not be economically deduplicated.
- Validate per-dataset record counts, VALID/WARNING counts, and source-row/provenance consistency against that dataset's shared context. Keep filenames and producer contexts per dataset; do not require one global filename or producer batch ID.
- Use one database transaction across all parent/child/record/warning writes. A known failure rolls back the complete group; no partially persisted dataset subset is successful.
- Retain a zero-accepted dataset child with `COMPLETED_EMPTY`, its metadata, received/rejected counts, and empty accepted records. This includes an all-rejected dataset; rejected financial records still do not enter the accepted table. A group of such datasets is not silently discarded. An empty payload with no datasets is distinct and needs an explicit backend policy.
- Preserve WARNING status and every warning field. Warning/transformation original scalar values are sensitive accepted-payload evidence, not permission to require or reconstruct full raw/staging data.
- On **unknown COMMIT outcome**, return/retain `COMMIT_OUTCOME_UNKNOWN` with the original attempt ID and investigate that ID using the backend's authoritative outcome mechanism. Do not automatically retry with the same or a new ID, assume rollback, or let connection-release errors hide the uncertain outcome.
- Return a grouped receipt identifying the attempt, each child batch/dataset/producer context and outcome, and per-dataset plus aggregate counts. A confirmed receipt counts actual persisted rows; a pending/unknown outcome must distinguish expected counts from confirmed persistence.

The future C1-specific backend validator must validate the reduced transport directly. It must not demand raw, staging, candidate, profile, mapping, or options objects that C1 excludes. Accepted/status counts can be checked against the received accepted arrays; received/rejected/completeness/duplicate counts remain producer summary claims without the omitted raw evidence. Preserve their existing definitions and provenance rather than presenting them as independently reconstructed accuracy.

An internal trusted `IngestionResult[]` compatibility path may remain, delegating to a common grouped persistence service after its own explicit checks. Preserve rejection of duplicate supplied datasets before any C1 projection could conceal them. Reprocessing/supersession and changed-file logical replacement remain backend lifecycle responsibilities, not this readiness implementation.

## C1 analytics adapter — proposed implementation

**Owner: Frederick. Not implemented here.** Add a separate `analyzeAcceptedDataPayload(payload, warningPolicy)` boundary; preserve the existing `analyzeIngestionResults(results, warningPolicy)` adapter and its behavior.

1. Preflight supported schema/ruleset `0.1` before row traversal. Validate an explicit `include` or `exclude` WARNING policy; do not substitute finance presentation labels.
2. Reconstruct provenance only from actual shared dataset metadata and row coordinates. Preserve money/identifier strings, separate dates and canonical basis, monetary basis/direction, warnings, currency origin, and transformations. Do not invent omitted raw/mapping evidence or reparse files.
3. With `include`, analyze VALID + WARNING and preserve every warning. With `exclude`, analyze VALID only and report warning exclusions without changing source status/eligibility. Rejected rows are not in C1 and must never be fabricated as accepted input.
4. Reuse existing exact-decimal aggregation and anomaly behavior through narrowly shared analysis functions. Keep debit, credit, signed source amount, and amount-with-direction groupings separate; no universal cash-flow, revenue/expense, profit, ratios, or currency conversion follows from these representations alone.

### Ledger interpretation availability

C1 deliberately omits `derived_ledger_net` and carries no approved dataset-specific accounting interpretation metadata. A source label such as “Ledger,” account code, or two Debit/Credit columns does not supply that approval.

Use an **analysis-specific** record/view that retains accepted fields and reconstructed provenance, with interpretation availability separate from the ingestion record. For example, an analysis input can omit `derived_ledger_net` from its canonical-field selection and expose these proposed interpretation states:

| State | Meaning |
| --- | --- |
| `AVAILABLE` | A matching, explicitly approved dataset convention permits a ledger calculation; value remains an exact decimal string |
| `UNAVAILABLE` | Debit/credit record has no approved applicable convention; value is `null`, with an explicit reason |
| `NOT_APPLICABLE` | Signed-amount or amount-with-direction record; ledger net is `null` and is not derived |

Associated interpretation metadata, if later supplied, must bind to the actual dataset/file/producer execution and identify the agreed convention. Its format is an owner review prerequisite, not a new C1 field. Stale, contradictory, or unrelated metadata must not silently apply. For an explicitly approved `DEBIT_MINUS_CREDIT` convention, calculate only debit/credit ledger rows with the existing exact `subtractDecimals` helper; that result still does not imply cash flow or revenue/expense.

With no such metadata, retain ledger records and mark their interpretation **UNAVAILABLE**. Do not reject them, change their VALID/WARNING status, manufacture zero/net values, or cast an incomplete projection into a full `CanonicalTransaction`. Keep the existing ingestion contract untouched.

The existing aggregation helper skips null values when summing. Therefore, reuse must not report a partially available ledger sum as complete: if any included ledger row in a group is unavailable, expose a null/unavailable ledger total and its unavailable-row count. Preserve independent source-column aggregates where supported. No approved interpretation exists for this synthetic fixture merely because its source is named Ledger.

Equivalence tests should compare old/new adapters' common fields, accepted IDs, warnings, provenance, date/money strings, source-column aggregates, and anomaly results under each warning policy. Without interpretation metadata, the new adapter's unavailable ledger values are an **expected explicit difference**. A separately labelled synthetic approved-convention case can test exact arithmetic equivalence; it is not client confirmation. Frederick may generalize internal analysis input types/functions narrowly, while retaining existing public adapters and tests; no fabricated canonical fields or producer-contract change is allowed.

## Synthetic test boundary and expected outcomes

Use exact published bytes from the manifest and [expected.json](../../public/samples/ingestion/expected.json), not substitute datasets. These are synthetic test files, not client data.

| Dataset | Received | VALID | WARNING | REJECTED | Accepted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ledger CSV | 10 | 10 | 0 | 0 | 10 |
| Bank XLSX, Transactions worksheet | 8 | 8 | 0 | 0 | 8 |
| Edge CSV | 8 | 2 | 3 | 3 | 5 |
| Total | **26** | **20** | **3** | **3** | **23** |

Use published reviewed fixture options; bank `Details → reference` is the required manual correction. Required completeness is a presence metric, not accuracy; repeated source rows are not reconciled economic duplicates.

| Future owner test | Expected result / invariant |
| --- | --- |
| Grouped persistence | One parent attempt, three dataset batches, 23 accepted records, three warning issues, zero rejected financial records |
| Mixed files/producer runs | Preserve each filename, worksheet, batch ID, timestamp, and summary independently |
| Duplicate dataset or inconsistent provenance | Explicit failure; no silent consolidation, partial writes, or fabricated evidence |
| All-rejected dataset | Retain `COMPLETED_EMPTY` child; zero accepted financial rows; actual received/rejected counts |
| Later dataset write failure | Entire transaction rolls back |
| Unknown COMMIT | Original pre-transaction attempt ID remains available; no automatic retry |
| Analytics WARNING include/exclude | 23 / 20 accepted IDs respectively; exclusion does not mutate payload warnings |
| No ledger interpretation metadata | Ten accepted ledger rows remain available as data, with unavailable ledger interpretation; no invented financial metrics |
| Approved synthetic ledger convention | Exact decimal helper only on applicable ledger rows; bank direction is never treated as ledger or universal cash flow |
| Cross-adapter equivalence | Shared values/lineage/warnings and supported analysis outputs agree; unavailable interpretation differences are explicitly asserted |

The implemented [fixture guard](../../tests/ingestion/fixture-integrity.test.ts) provides four size/SHA-256 checks. Existing [C1](../../tests/ingestion/accepted-data.test.ts) and [C2](../../tests/ingestion/ingestion-run.test.ts) regressions remain unchanged. Owner tests above are requirements, **not executed backend/analytics integration claims**.

## Ownership, prerequisites, and rollback

| Owner | Separately authorized work |
| --- | --- |
| Chia | Selective C1/C2 transfer, additive exports, fixture verification, narrow shared UI orchestration if requested |
| Celester | Grouped runtime validator/service/schema/receipt, permanent IDs, transaction outcomes, persistence/supersession and backend summaries |
| Frederick | Second analytics adapter, explicit unavailable interpretation, exact aggregates/anomalies, equivalence tests, verified test discovery/TS compatibility |
| Jason | Authentication, access control/RBAC, backend trust boundary, sensitive evidence/download controls, security/audit requirements |
| Izzat | Backend/API-driven dashboard indicators and source drill-down; no direct ingestion React dependency |

Before connecting modules, review actual target drift, interpretation metadata format, grouped receipt/reservation mechanics, and explicit no-dataset submission behavior with their owners. Client accounting conventions, required fields/currencies/date choices, and retention still require confirmation. Production validation/security and a separate authorized evidence-retention path remain prerequisites; TypeScript and browser checks do not implement them.

Review sequence: **C3-I0 materials → selective transfer/configuration gates → owner backend and analytics increments → cross-module tests → integration approval.** No producer/schema/ruleset bump is planned. Stop for technical review if a consumer needs information that cannot be supplied by C1 or associated approved metadata.

Rollback for this local increment is limited to removing the three new readiness/test files and reverting the example comment, after authorization. Future transfer/owner increments should remain separately reviewable and reversible. Do not reset historical checkpoints, overwrite teammates' branches, restore the protected sample stash, or modify deployment settings to resolve integration conflicts.
