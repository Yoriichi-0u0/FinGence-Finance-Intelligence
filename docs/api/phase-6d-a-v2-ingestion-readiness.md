# Phase 6D-A — FinGence 2.0 ingestion integration readiness

26 October 2026. Repository `Yoriichi-0u0/FinGence-Finance-Intelligence`, branch `feature/backend-api-celester`, reviewed starting commit `aea035f8568d883dadadccb031ec2d9f87f65eb3`.

**Status: backend assessment and integration proposal only. Chia's V2 verified-output TypeScript contract is not finalized. No V2 payload, adapter, migration, authentication, policy or endpoint is implemented by this phase.** Concepts below describe requirements and open decisions, not producer field names, enums, transport keys or an approved database design.

The user's V2 direction supersedes old C1–C3 planning assumptions for future integration. Existing source and handoff files remain authoritative for the legacy implementation only; their statements about a future C1 adapter do not specify V2. Existing behavior and historical data must remain supported without silently relabeling them as AI-verified.

## Evidence reviewed

| Source | Relevant facts |
| --- | --- |
| [AGENTS.md](../../AGENTS.md), [AI context](../handoff/AI_CONTEXT.md), [team handoff](../handoff/TEAM_HANDOFF.md), [legacy architecture](../ingestion/architecture.md) | Legacy financial semantics, provenance, consumer version gates and ownership boundaries |
| [Ingestion models](../../lib/ingestion/models.ts), [C1 projection](../../lib/ingestion/accepted-data.ts) | `IngestionResult` contains dataset/profile/mapping/options/raw candidates; C1 is a smaller projection, not the same input |
| [Persistence contracts](../../lib/server/persistence/contracts.ts), [preflight](../../lib/server/persistence/validate.ts), [mapping](../../lib/server/persistence/map.ts) | Version `0.1` only; backend types import legacy canonical models; validation compares normalized rows to processed candidates and source structure |
| [Grouped service](../../lib/server/persistence/grouped.ts), [repository](../../lib/server/persistence/repository.ts), [service](../../lib/server/persistence/service.ts) | Preflight before writes; parameterized accepted-row/warning storage; parent and child writes in one transaction; receipt after COMMIT |
| [PostgreSQL adapter](../../lib/server/db/postgres.ts), [grouped handoff](../database/c3b1-internal-handoff.md) | Exact parsers, bounded transactions, uncertain outcome classification, fenced investigation and no automatic retry |
| [Clean schema](../../supabase/sql/phase1-clean-setup.sql), [source-file upgrade](../../supabase/sql/phase1-source-file-upgrade.sql), [grouped upgrade](../../supabase/sql/c3b1-grouped-persistence-upgrade.sql) | Actual storage constraints and relationships; clean setup and source-file upgrade are alternative paths, not scripts to stack blindly |
| [Transaction service](../../lib/server/api/transaction-query.ts), [batch service](../../lib/server/api/batch-query.ts), [Phase 6A](phase-6a-transactions.md), [6B](phase-6b-transaction-query.md), [6C](phase-6c-batch-query.md) | Scoped internal reads, explicit DTOs, exact output, pagination and mandatory injected security dependencies; no public routes |

No hosted schema or data was inspected. Findings concern the checked-out SQL and implementations, exercised by existing disposable-database tests; they are not proof of hosted compatibility or of V2 readiness.

## What can be reused, and what cannot yet be reused

| Component | Reuse assessment | Conditions |
| --- | --- | --- |
| `SqlConnection`, `TransactionDatabase`, `transactionDatabase` | Reuse transaction mechanics | Retain one connection, parameterized values, deadlines, rollback classification, receipt-after-COMMIT and connection cleanup. The implementation currently imports legacy `PersistenceError`; do not describe the entire module as independent of legacy contracts |
| Per-pool NUMERIC/date parsers and current API formatting | Reuse exact-value mechanisms | Preserve decimal text, native SQL comparisons, explicit ISO/UTC output and NULLs; agree precision/lexical retention requirements before accepting V2 |
| Grouped transaction orchestration pattern | Reuse the atomicity/fencing pattern, not `persistGroupedAttempt` as a V2 entry point | That function accepts `IngestionResult[]`, reads legacy dataset metadata, calls legacy validation/mapping and writes the legacy schema |
| `contracts.ts`, `validate.ts`, `map.ts` | Keep as legacy-specific implementations | They import `CanonicalTransaction`/`IngestionResult`, pin schema/ruleset `0.1`, expect raw/candidate/normalized agreement and hash/sheet/row identities. Neither C1 nor V2 can be cast into them |
| Current repository | Reuse parameterization, UUID/FK assignment, count checks and explicit column selection patterns | Actual column mapping, warning triggers, counts and completion rules require a reviewed V2 compatibility map. Do not bypass preflight with an asserted `PersistencePlan` |
| Transaction and batch query services | Reuse for existing stored projections; reuse their boundary patterns for future reads | They expose legacy statuses/counts/monetary bases. They cannot represent unresolved decisions or prove AI verification. A V2 read model needs an explicit compatibility decision before these APIs consume new storage |
| Existing tests/disposable database harnesses | Reuse as backend safety baseline | Passing them establishes legacy mechanics, not a V2 contract or real security integration |

The current plan is not a neutral persistence format: `FinancialRecordValues` derives from the legacy canonical model. A later neutral backend plan must be designed explicitly; a type alias or unsafe cast does not decouple that dependency.

## Actual database capabilities and gaps

| Requirement | Present support | Gap / decision before implementation |
| --- | --- | --- |
| Verified accepted financial records | `financial_records` stores accepted `VALID`/`WARNING` with source dates, monetary basis, currency origin, provenance and transformations | Acceptance is legacy ingestion eligibility, not proof of AI or human verification. No agreed V2 eligibility mapping, verification revision, authority or decision linkage exists. Never promote records from a confidence score alone |
| Rejected decisions | `ingestion_batches.rejected_count` stores a count | Rejected candidates/issues are excluded from accepted storage. No durable rejected-decision/evidence model exists. A count is not retrievable evidence |
| Unresolved decisions | None in row status, batch counters or warning-only issues | No legitimate mapping to REJECTED, WARNING, NULL money or `COMPLETED_EMPTY`. Need producer meaning and reviewed storage/publication policy; keep unresolved material outside accepted reads |
| Source evidence | File SHA-256, basename, sheet/row, source-row ID, producer batch/time; warning original values and transformations | No original-file archive, general evidence reference registry, page/region/fragment model or record-to-many-evidence relation. Row-centric required columns cannot represent every future source without fabricating coordinates. `context` JSONB is sensitive legacy metadata, not an approved V2 evidence dump |
| Verification provenance | Legacy schema/ruleset versions on batches; source provenance on records | No explicit V2 producer-contract or verifier/policy/model revision and decision provenance scheme. Which facts Chia supplies, and which must be stored, are unresolved |
| IDs and grouping | PostgreSQL batch/record UUIDs; nonunique producer batch ID; parent `persistence_attempts` UUID with `dataset_count`; nullable dataset/parent links on batches | No agreed V2 run/job/document/group identity, cardinality, replay key or cross-run decision identity. Source-row IDs are lineage, not persistent IDs or economic deduplication keys |
| Failures and incomplete work | In-process bounded errors; legacy batch statuses include PROCESSING/FAILED; uncertain COMMIT/rollback handling | Parent attempts contain only `id`, `dataset_count`, `created_at`. No durable job stage, progress, failed-attempt record, cancellation or partial processing outcome exists. Grouped rollback removes parent and children; the writer does not persist a FAILED batch on rollback |
| Exact values and unavailable fields | Unconstrained PostgreSQL NUMERIC, nullable monetary columns, source date/basis separation | Backend input limits are currently 128 characters for most decimals and 260 for derived net. Agree V2 ranges/representations; do not round, coerce through JS Number, infer signs, convert currencies, substitute dates or replace unknown values with zero |
| Original lexical representation | Current transport preserves decimal strings; PostgreSQL preserves numeric value and often scale | NUMERIC does not preserve every original spelling or negative-zero sign (`-0.00` becomes `0.00`). If source spelling is required, retain it in separately reviewed evidence; do not claim a numeric read reconstructs original bytes |
| Count semantics | Received = VALID + WARNING + REJECTED; accepted = VALID + WARNING; warning issues linked to accepted records only | V2 decision units may differ from rows or records; unresolved/split/merged decisions cannot be inserted into that equation without agreement. Batch warning summaries must not be advertised as complete V2 verification summaries |
| Atomic grouped persistence | Parent, child batches, accepted records and warning issues commit together | V2 grouping and all-rejected/all-unresolved/empty meanings are unknown. Publication must not expose an incomplete accepted group. No artificial placeholder file, row, record, issue or timestamp may be invented to satisfy constraints |
| Replay and lifecycle | Attempt UUID uniqueness, lock serialization, limited commit investigation, supersedes FK and stored statuses | No payload-bound idempotent replay, economic deduplication, general revision history or automatic superseding. Distinct UUIDs create new history. Decide correction/reverification and activation/reporting populations explicitly |
| Ownership and retention | Server-only RLS/client revocations; RESTRICT FKs | No actor/organization mapping, production ownership policy, protected audit sink or evidence retention/deletion design. Privileged DB access is not tenant isolation. Historical NULL ownership cannot imply access |

Existing `schema_version`/`ruleset_version` batch constraints accept only `0.1`; changing producer constants cannot enable V2. Any reviewed storage evolution must address these constraints, enum/check constraints, required provenance, FKs, compatibility with readers, historical rows and populated-schema upgrade tests. No SQL changes are proposed for execution here.

## Keep four kinds of outcome separate

1. **Financial verification decision:** Chia defines when a candidate is accepted, rejected or awaiting resolution, and who can finalize/correct that decision. Those names here are requirements concepts, not a guessed V2 enum.
2. **Processing execution:** a run may fail, stop or be incomplete before producing a publishable result. Failure may exist even with no financial row or database batch.
3. **Persistence acknowledgement:** COMMIT acknowledged, definite failure, `COMMIT_OUTCOME_UNKNOWN` or `ROLLBACK_UNCONFIRMED`. Uncertainty is not rejection and must not trigger a blind retry.
4. **Investigation result:** current `CONFIRMED_COMMITTED` / `CONFIRMED_NOT_COMMITTED` / `UNRESOLVED` describe fenced storage investigation, not AI decision quality. The same writable primary, retained attempt identity and writer fence are required; a missing batch from the list API is not proof of rollback.

`COMPLETED_EMPTY` remains a legacy completed zero-accepted dataset state. Do not reinterpret it as AI unresolved, processing failure, omitted output or proof that every candidate has a final decision. Existing statuses are preserved, not extended by this document.

## Proposed versioned backend boundary — design only

```text
Chia's finalized, versioned verified output
  -> server composition supplies trusted origin/access context (Jason)
  -> explicit decoder for the agreed producer contract/version (Celester + Chia fixtures)
  -> semantic compatibility map and independent runtime validation
  -> backend-owned validated persistence plan, defined after mapping review
  -> parameterized repositories on one PostgreSQL transaction
  -> commit acknowledgement / safe receipt / fenced uncertain-outcome handling
  -> authorized, audited publication through explicitly approved read models

Rejected/unresolved decisions and protected evidence references
  -> separate reviewed storage/publication treatment, never the accepted-record query
```

- Keep the external producer contract version, backend integration/plan version, database migration version and public API version separate. Financial rules/verifier revisions are additional provenance where agreed. A marketing name such as “2.0” is not a protocol identifier. No version literal or wire property is chosen here.
- Obtain Chia's actual version-discrimination mechanism; it might be an envelope or a negotiated server-side route/configuration. Do not assume V2 has `schema_version`, `ruleset_version`, `datasets`, `normalized`, `records` or any other C1–C3 property. Dispatch must select an explicitly supported decoder; unknown/missing/ambiguous versions fail before writes, with no best-effort legacy fallback.
- Input starts as untrusted/unknown until decoded and independently validated. TypeScript types and a model's “verified” assertion are not runtime validation, authenticated origin or financial permission. Chia owns financial verification; Celester checks contract structure, safe exact representation, required relationships, completeness and the approved acceptance/publication invariants without rerunning or changing accounting decisions.
- The backend plan is an internal, owned snapshot, independent of Chia's in-memory engine types. Define its fields only after the producer contract and compatibility map are reviewed. Do not extend/cast to `IngestionResult[]`, manufacture raw/mapping/options/profile objects, synthesize legacy row IDs or invoke `preparePersistencePlan` on a disguised V2 object.
- Preserve a separate legacy path with its existing version gates and tests. A supported V2 decoder and repository can coexist later; legacy rows must not be backfilled with fabricated verification provenance. Sharing lower-level utilities must not widen the legacy validator or silently change Phase 6A–6C DTO meaning.
- Proposed server-owned request/group correlation is distinct from producer execution/decision identity and database IDs. Agree allocation, cardinality, scope, payload binding, retries and receipts before coding. None of these concepts chooses Chia's wire fields or grants access.
- Preflight the entire proposed persistence group before writes. Reuse single-connection atomicity for approved DB changes; retain identity for investigating uncertain acknowledgements. If long-running job/failure recording needs to survive rollback, design its lifecycle separately rather than pretending the current grouped parent is a durable job ledger.
- Do not run AI calls or file uploads inside a long PostgreSQL transaction. Object storage and PostgreSQL do not share the current transaction boundary: agree staged evidence references, integrity/existence checks, publication gating and orphan cleanup/compensation (or another reviewed coordination design). Do not return final success while required evidence or decision persistence is incomplete.
- Required security checks and durable audit remain Jason's implementations behind injected interfaces. Resolve ownership from trusted stored state, not output fields or client IDs; audit actions/correlation IDs rather than prompts, financial contents, credentials or raw errors. Existing query services remain unexposed until those adapters exist.

## Exact handoff information needed from Chia

No request is sent on the user's behalf. This is the technical checklist to resolve before Phase 6D-B:

| Needed artifact or decision | Specific question | Backend dependency |
| --- | --- | --- |
| Published contract and version authority | Where is the authoritative TS export/specification and reviewed commit? How is version compatibility discriminated? What changes require a new version? | Decoder selection and compatibility tests; no `any`/casts or producer-constant auto-adoption |
| Runtime shape and synthetic fixtures | Which fields are required, optional or explicitly NULL? Are outputs plain JSON or richer TS values? Provide valid, invalid, minimal, empty and mixed outcomes | Runtime validator, limits, serialization and missing-versus-NULL behavior |
| Meaning of verified acceptance | What proves final acceptance, who can revise/approve it, and are warnings independently represented? Are confidence/verification results advisory or final? | Eligibility map; no automatic conversion to legacy VALID/WARNING |
| Rejected and unresolved outcomes | What exact decisions exist, when are they final, and is there output for failures/partial results? Supply all-rejected, all-unresolved and incomplete examples | Separate durable decision model, count equations, publication gates |
| Financial representation | Decimal encoding, range/scale, signed amount/direction/debit-credit semantics, missing/unknown values, date basis/timezone and currency provenance; supply boundary examples | Exact validation/storage; no new accounting interpretation |
| Evidence/provenance | What source references/coordinates/hashes are supplied; one or many sources per record; extraction/transformation links; how original files are retained and dereferenced | Evidence schema and relationship/retention proposal; avoid fabricated sheet/row data |
| Identity and cardinality | Which identities persist across retry/reverification? Can a source item split into multiple records or several sources merge? How do runs, groups and outputs relate? | ID mapping, FK cardinalities and deduplication boundaries |
| Delivery and atomic group | Whole output or streaming/chunks? Ordering, completeness signal, expected counts, maximum payload size and whether partial groups can be published | Staging/finalization, transaction size and incomplete-outcome design |
| Failures, cancellations and retries | Which failure results are emitted, how are original IDs retained, and can a transport redeliver the same verified output? | Durable job/request lifecycle, payload-bound replay/conflict behavior and safe receipts |
| Corrections and revision lineage | Does later verification replace, supersede or coexist with an earlier decision? Are edits immutable revisions? What is the intended active population? | Lifecycle storage and read-model compatibility |
| Sensitive metadata and retention | What evidence, verifier/rule/model metadata and original values must be persisted, for how long, and who needs access? | Minimal storage projection and separate evidence/audit review with Jason |
| Deterministic acceptance fixtures | Can Chia supply expected accepted/rejected/unresolved membership, counts, exact values and evidence links for representative outputs? | Independent integration tests that do not merely mirror the new mapper |

Celester additionally needs deployment/runtime and storage capacity decisions from the team, approved ownership/audit/cursor interfaces from Jason, and client/team confirmation where financial conventions or retention remain open. These are not all questions for Chia alone.

## Phase 6D-B implementation sequence and entry gates

1. **Contract checkpoint:** Chia publishes the reviewed contract/version mechanism, semantics and synthetic fixtures. Celester records a field-by-field compatibility map, required invariants and unresolved questions; Jason reviews trust/evidence boundaries. Do not start a V2 adapter while any required meaning is unknown.
2. **Schema proposal checkpoint:** derive a storage gap specification from that map, including decision/evidence cardinalities, nonfinal outcomes, job versus persistence identities, exact values, legacy compatibility and retention. Prepare a separately reviewed additive migration proposal and populated historical-schema test plan. No schema change or hosted execution is authorized by Phase 6D-A.
3. **Implementation checkpoint:** only after approval, build the version-specific decoder and new backend plan/writer as needed; retain the legacy path. Inject security/DB/storage dependencies, bound resources and fail closed on unsupported/incomplete payloads. Do not implement Jason's policies or cryptography.
4. **Local verification checkpoint:** independent fixtures must cover exact decimals/NULLs/IDs/dates, unknown versions and malformed data, accepted/rejected/unresolved separation, evidence links, splits/merges if supported, whole-group rollback, no partial receipts, all-zero/nonfinal groups, replay/conflicts, lost COMMIT acknowledgement and investigation without automatic retry. Reuse disposable PostgreSQL and real `pg` wiring; test historical data alongside the reviewed new schema. Add security-adapter integration tests when Jason's implementations exist.
5. **Release checkpoint:** review code/schema/DTO differences and full local checks with the user before committing/pushing. Public HTTP routes, hosted migration execution, deployments and merge each require their own authorization/readiness; internal tests do not waive these gates.

**Phase 6D-A recommendation:** make no runtime change yet. No finalized V2 fields are available to justify an adapter, broader schema enums or changes to financial semantics. Contract-independent backend mechanisms already have exact-value, atomicity and failure regression tests; rerun that baseline rather than invent a fake V2 fixture or change another owner's module. The three Phase 6C pagination test follow-ups remain separate, documented work.

## Local validation for this assessment

Only backend documentation is changed. Existing API/persistence tests were rerun to verify the reviewed legacy baseline; these results are not V2 verification. No new tests or runtime interfaces are added because this phase establishes requirements rather than an executable V2 contract.

Command: `corepack pnpm exec vitest run tests/api tests/persistence tests/integration/grouped-consultation.test.ts` — **415 tests passed across 18 files**, with no skips in this selected run. All 22 relative source/document links in this assessment resolve. Git diff/whitespace checks pass, including the new document. TypeScript/lint/full-suite checks were not repeated for this documentation-only change; the Phase 6C full-suite result remains a historical baseline, not a new V2 claim.
