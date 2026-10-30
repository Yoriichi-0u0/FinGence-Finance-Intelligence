# FinGence — current technical entrypoint

Updated 27 October 2026. Start here before editing or consuming this repository.
This guide describes the source introduced by [PR #4](https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence/pull/4),
including Increments 01–03B. Check that PR and the actual checkout for merge/CI state;
check the Vercel deployment's source SHA before claiming a hosted release. Dated status
statements elsewhere are historical; they do not override this guide or the actual code.

## PoC anomaly review and management report (31 October 2026, issue #31)

[Anomaly review and report](../integration/poc-anomaly-review-report.md): on the local M5 stack,
`/anomalies` replaces the mock with transparent rules over a Finance-uploaded synthetic source CSV,
explicit audited review decisions, and a downloadable PDF/JSON management report. Reconciliation is
quoted only from a `FinancePoCReconciliationV1` snapshot (Codex, #30); until wired it reads unavailable.

## M5 development checkpoint (31 October 2026)

[Local tenant administration](../integration/v2-m5-tenant-administration.md) adds `/admin`
and `/enroll` (`pnpm m5:dev`): OS-owner organization bootstrap with a one-time Admin code,
Admin-issued single-use enrollment into inactive memberships, role/activation changes,
session revocation, account suspension separate from membership, and an organization audit.
Suspension is enforced by the shared session resolver; legacy M3 management delegates to M5.
Local only; no hosted identity, Production users or audit migration.

## M4 development checkpoint (30 October 2026)

[The M4 provider boundary and evaluation](../integration/v2-m4-model-boundary.md) connect
recorded controls and a separately authorized one-shot Groq CLI to the same M2 verification,
V2 persistence and M3 consumers. The browser remains RECORDED_TEST; no M4 live inference
has run. Durable dispatch uncertainty, shared quotas and source/tenant-bound authorization
remain fail closed. This is a stacked development checkpoint, not a hosted activation.

## M3 development checkpoint (30 October 2026)

[The connected M3 consumers](../integration/v2-m3-financial-consumers.md) now present
one tenant-owned verified V2 selection in the actual local Transactions, Analytics
and Reports pages, with exact source calculations, chart/date grouping, downloadable
JSON and deterministic sourced answers. Local scoped management implements the three
roles; hosted identity, economic publication and live inference remain disabled.
This is a stacked feature checkpoint, not a main/Production release.

## M2 development checkpoint (30 October 2026)

The local-only V2 tenant financial pipeline is documented in
[the M2 runbook](../integration/v2-m2-tenant-financial-pipeline.md). Its `/ai-ingestion`
workspace connects actual extraction and independent verification to owned V2 persistence,
exact source calculations, JSON export and deterministic questions. Interpretation is
explicitly SIMULATED; live inference and financial publication remain disabled. This
section describes the feature branch, not a merged or hosted release.

## What is available

- **Stable deterministic path:** CSV/XLSX → reviewed mapping/conventions → validation →
  normalized VALID/WARNING records → C1 projection → actual analytics on the Data page.
  Reprocessing uses C2 fresh execution context and replaces that dataset's previous result.
- **Experimental local V2:** CSV/XLSX/PDF/PNG/JPEG → evidence → proposed financial rules →
  deterministic materialization → independent verification. Source availability on `main`
  does **not** enable hosted AI. The experimental pages and their APIs deny production.
- **Backend/security:** grouped persistence, scoped read composition and audit storage are
  server modules verified locally. See [P2 local integration](../integration/p2-backend-security.md).
  Production identity/membership, tenant ownership, hosted persistence and client accounting
  approval remain incomplete. Do not expose financial endpoints without those boundaries.
- **V2-I1 local integration:** [experimental automated processing and persistence](../integration/v2-i1-local.md)
  joins V2 verification to a disposable local database. It does not make results eligible
  for production financial publication or provide real application authentication.
- One genuine Groq request has been executed. It produced six correct mappings but null
  conventions and incorrect context references: zero accepted, two unresolved rows.
  03B refined instructions offline; improved live accuracy remains unmeasured.

## Product naming

The product name is **FinGence** (Finance + Intelligence), including browser metadata,
navigation, logos and report mastheads. The package identifier is `fingence-finance-intelligence`.
Current URL: [fingence-financeintelligence.vercel.app](https://fingence-financeintelligence.vercel.app/).
The old [finsight-financeintelligence.vercel.app](https://finsight-financeintelligence.vercel.app/)
remains a production alias; it is a legacy hostname, not the current product name.
The academic project title remains **Finance Intelligence: AI-Driven Financial Analysis and
Automated Reporting**. Historical FinSight release text/identifiers are retained as evidence.
Compatibility names such as `FINSIGHT_*` environment/test variables and the existing database
`application_name` are technical identifiers, not a second product name; do not rename them
incidentally and break callers or operational tracing.

## Stable C1/C2: use the public ingestion module

Import from [`lib/ingestion/index.ts`](../../lib/ingestion/index.ts). It exports:

| Exact exports | Responsibility |
| --- | --- |
| `inspectFile`, `createDataset`, `isDuplicateFile`, `sanitizeFilename`, `READER_LIMITS` | Existing bounded CSV/XLSX readers and file/dataset identity |
| `profileDataset` | Source profiling; no accounting approval |
| `suggestMapping`, `overrideMapping`, `approveMapping`, `mappingErrors` | Deterministic suggestions and explicit review |
| `ingestDataset(dataset, mapping, options, context)` | Caller-supplied context; authoritative validation/normalization |
| `ingestDatasetRun(dataset, mapping, options, providers?)` | C2: one fresh ID/time pair for each attempted execution |
| `consolidate(results)` | Existing retained-result replacement/order; not reconciliation |
| `createAcceptedDataPayload(results)` | Pure C1 projection; no execution, ID/time generation or persistence |
| `canonicalCSV`, `rejectedCSV`, `evidenceJSON` | Existing serializers; full evidence JSON is not the C1 API payload |

All models/defaults are exported from [`models.ts`](../../lib/ingestion/models.ts).
Primary types: `Dataset`, `ColumnMapping`, `IngestionOptions`, `IngestionContext`,
`IngestionResult`, `CanonicalTransaction`, `Provenance`, `ValidationIssue`, `QualitySummary`.
C2's `IngestionRunProviders` has optional `idFactory` and `now` functions. Failed attempts
may consume context but store no result. Inspection, projection and exports generate none.

C1's exact types are in [`accepted-data.ts`](../../lib/ingestion/accepted-data.ts):
`AcceptedDataPayload`, `AcceptedDataset`, `AcceptedDatasetSummary`, `AcceptedTransaction`,
`AcceptedWarning`. Supported schema/ruleset are deliberately pinned to **0.1 / 0.1**.
The complete field contract is [here](../ingestion/accepted-data-contract.md); do not redefine it.
The smallest actual C1 JSON, from `createAcceptedDataPayload([])`, is:

```json
{"schema_version":"0.1","ruleset_version":"0.1","datasets":[]}
```

For nonempty data each dataset has `dataset_id`, `source_system`, `source_file`,
`source_sheet`, `file_sha256`, `ingestion_batch_id`, `ingested_at`, `normalized`, `summary`.
Rows retain exact canonical financial/date fields, row identity, statuses, warning scalars
and approved transformations. `derived_ledger_net`, raw/staging/candidate records, mapping
options and rejected evidence are deliberately absent. See the executable
[C1 example](../../examples/ingestion/accepted-data.ts) and
[team analytics example](../../examples/integration/team-reuse.ts).

TypeScript types are not external JSON validation or authorization. C1 consumes trusted
engine-produced `IngestionResult[]`; backend APIs must enforce their own trust boundary.

## Experimental V2: reuse these exact entrypoints

| Path / exports | Version / purpose |
| --- | --- |
| [`contracts.ts`](../../lib/ai-ingestion/contracts.ts), `extractDocument` in [`extract.ts`](../../lib/ai-ingestion/extract.ts) | Increment01 `v2-evidence-0.1`, `v2-blueprint-0.1`, `v2-result-0.1`; preserved earlier path |
| [`increment-02/contracts.ts`](../../lib/ai-ingestion/increment-02/contracts.ts) | `SemanticEvidence` (`v2-evidence-0.2`), `semanticBlueprintSchema` (`v2-blueprint-0.2`), `SemanticVerification` (`v2-verification-0.2`) |
| [`extractSemanticEvidence(input, filename)`](../../lib/ai-ingestion/increment-02/extract.ts) | Current shared four-format extraction; original cells and source page/sheet/row/region coordinates |
| [`terminologyRegistry`, `POLICY_VERSION`](../../lib/ai-ingestion/increment-02/registry.ts) | Policy `experimental-financial-terminology-0.2`; synthetic, not client-approved accounting policy |
| [`planSchema`, `requestPlanSchema`, `prepareRequest`, `materializePlan`](../../lib/ai-ingestion/increment-03/plan.ts) | `v2-plan-0.3`, prompt `rule-guidance-0.3b`; source-derived header/context IDs; exact source-value binding |
| [`verifySemanticBlueprint(bundle, input, origin?)`](../../lib/ai-ingestion/increment-02/verify.ts) | Independent evidence/policy/coverage/financial authority; model confidence grants no acceptance |
| [`createSemanticTemplate`, `rebindSemanticTemplate`](../../lib/ai-ingestion/increment-02/reuse.ts) | Only verified nonempty blueprints; fresh evidence is rechecked; reuse is not inference |
| [`processLiveDocument03`, `Run03`](../../lib/server/ai-ingestion/increment-03/service.ts) | Server-only `v2-run-0.3` orchestration; registered synthetic bytes only |
| [`GroqProvider03`, `OllamaProvider03`, `Receipt03`](../../lib/server/ai-ingestion/increment-03/providers.ts) | Explicit provider origin, bounded dispatch/usage, no automatic retry/fallback |

`POLICY_VERSION` is defined in `increment-02/contracts.ts` and consumed by the registry.
Zod schemas validate the declared proposal structure. `requestPlanSchema(evidence)` produces
the narrower per-source ID constraints; `prepareRequest` generates its JSON Schema.
Those checks are separate from financial verification. Do not create competing schema copies.

Complete synthetic input/output examples are retained in the [original 03 evaluation traces](../ai-ingestion/increment-03/evidence/traces/heldout/01.json).
The [actual failed proposal](../../tests/fixtures/ai-ingestion-03/first-live-failed-proposal.json)
is schema-valid `v2-plan-0.3` with `conventions: null`; materialization must still stop.
An **excerpt**, not a complete run object, for unavailable inference is:

```json
{"version":"v2-run-0.3","mode":"NOT_EXECUTED","promptRevision":"rule-guidance-0.3b","proposal":null,"blueprint":null,"verification":null,"receipt":null}
```

`LIVE_GROQ`, `LIVE_OLLAMA`, `RECORDED_TEST` and blueprint reuse remain distinct. The earlier
`LIVE_OPENAI` seam is preserved, not evidence of an executed OpenAI experiment. The seen
h01 case cannot be counted as independent generalization evidence. Evaluation labels and
recorded proposals stay outside runtime inference inputs; never send the full workbook/oracle.

## Record meaning and financial invariants

| Path | Accepted | Rejected | Unresolved |
| --- | --- | --- | --- |
| Stable ingestion/C1 | VALID + WARNING; warnings survive projection | Kept in `records`/evidence; never C1 `normalized` | No new C1 status; resolve choices before approved execution |
| Experimental semantic V2 | `verification.accepted`: machine-verified experimental records, VALID/WARNING | `verification.rejected`: known validation failures with evidence/issues | `verification.unresolved`: unsupported/ambiguous interpretation, coverage, assumptions or evidence; not silently accepted or rejected |

V2 document decisions (`VERIFIED`, `PARTIAL`, `NEEDS_REVIEW`, `REJECTED`) are not C1 row
statuses. A rejected proposal can leave all observed rows unresolved rather than rejected.
`FinancialValues` deliberately omits full canonical provenance and ledger net; it is not a
`CanonicalTransaction`. Never cast it to one.

Money and identifiers remain exact **strings**, including leading zeros. Transaction,
posting and canonical dates retain separate meanings. Preserve monetary basis, literal
source sign/direction, currency origin and approved transformations. Bank movements are
not general-ledger sides, revenue/expense or universal cash flow. Do not calculate complete
ledger totals without reviewed interpretation metadata; show unavailable/partial status.

`source_row_id` is lineage, `ingestion_batch_id` is execution identity, backend IDs are
persistence identity, and economic/reconciliation identity is downstream. None substitutes
for another. PDF/image coordinates must remain actual page/box evidence, never invented rows.

## Local runtime and provider boundary

Node **24.x**, pnpm **11.19.0**; pinned Next.js **16.4.1**. CSV/XLSX reuse the existing
TypeScript readers. PDF (digital/scanned) and PNG/JPEG use the local Python **3.12**
Docling/RapidOCR worker and existing model cache; dependencies are pinned in
[`requirements-ai.in`](../../requirements-ai.in) / [`requirements-ai-lock.txt`](../../requirements-ai-lock.txt).
Bounded experimental limits are documented in [03 architecture](../ai-ingestion/increment-03/architecture.md).
Windows/WSL instructions are [here](../ai-ingestion/increment-03/windows.md); execution there is not claimed.

`/ai-ingestion`, `/ai-ingestion/live`, `/ai-ingestion/developer` and corresponding
`/api/ai-ingestion`, `/api/ai-ingestion/live`, `/api/ai-ingestion/developer-replay` are
local-development experiments. Production/Vercel must deny them even if enable flags exist.
Local guards require development mode, local flags, loopback/same-origin access and no VERCEL
environment. These are PoC isolation controls, not complete authentication/RBAC.

Do not introduce keys, environment files, quota ledgers or private runs into Git/client
bundles/deployment traces. Existing ignore/trace exclusions cover those files and test/docs
labels. Local CLI defaults disable dispatch and do not load credentials. A usable key is
not dispatch authorization. Groq is fixed to `openai/gpt-oss-20b`, strict output, zero SDK
retries, with durable conservative quota accounting; no paid fallback is authorized.
Both temporary keys were revoked. Follow the [unexecuted second-request protocol](../ai-ingestion/increment-03/second-experiment-03b.md)
only after fresh secure-setup and dispatch authorization. Do not create credentials or pull models.

## Ownership and reusable integration recipes

**Chia:** deterministic ingestion/C1/C2 and experimental evidence/rules/materialization/verifier.
Review changes to these boundaries through their source/tests; do not recreate the pipeline.

**Celester:** backend/API, permanent IDs, persistence lifecycle, grouped atomic attempts and
supersession. Current server recipe (actual service, not a public API):

```ts
import { createGroupedPersistenceService } from "./lib/server/persistence/grouped";
// database is a server-owned TransactionDatabase; attempt_id is allocated before the transaction.
const receipt = await createGroupedPersistenceService(database)
  .persistGroupedAttempt({ attempt_id, results }); // full trusted IngestionResult[], NOT C1 or V2
```

Keep all datasets atomic, per-source batch/filename provenance, COMPLETED_EMPTY children and
unknown-COMMIT investigation. Never retry an uncertain attempt automatically. Existing
[grouped tests](../../tests/integration/grouped-consultation.test.ts) and
[schema migrations](../../supabase/sql/c3b1-grouped-persistence-upgrade.sql) are the authority.
Hosted schema migration is separately authorized; this merge performs none. Future external
C1 input requires a reviewed backend DTO/validator/mapper, not reconstructing raw evidence.

**Frederick:** use `analyzeAcceptedDataPayload(payload, warningPolicy, reviewedConventions?)`
from [`accepted-data-adapter.ts`](../../lib/analytics/accepted-data-adapter.ts), or preserve
`analyzeIngestionResults(results, warningPolicy)` for trusted full results. The executable
[team example](../../examples/integration/team-reuse.ts) uses the actual C1 producer.
WARNING include/exclude is explicit. Ledger interpretation requires dataset-specific
DEBIT_MINUS_CREDIT approval metadata; unavailable values remain null, not fabricated canonical fields.

**Jason:** verified authentication/membership, authorization, backend trust boundary and
protected audit service. Reuse the existing server-only policy/audit helpers:

```ts
import { authorize } from "./lib/server/security/authorization";
const decision = authorize(principal, "financial_record.read", resource);
// principal/resource must be server-resolved, not browser-supplied claims.
// Enforce denial, then construct an allowlisted event via createSecurityAuditEvent
// and send it to Jason's protected sink. Calling the helper alone does not persist an audit.
```

See [authorization tests](../../tests/security/authorization.test.ts) and
[`audit.ts`](../../lib/server/security/audit.ts). Log actions/relevant IDs, not full financial
contents, raw errors or tokens. Do not expose an unauthenticated persistence/inference endpoint.
The [P2 composition](../integration/p2-backend-security.md) requires caller-supplied trusted
identity, membership, ownership, audit database and cursor-key dependencies. Its synthetic
test resolvers do not implement production authentication or authorization.

**Izzat:** consume agreed backend/API reporting DTOs, or the typed in-memory analytics view
from [the team example](../../examples/integration/team-reuse.ts) when explicitly building a
local demonstration. Keep warning indicators and source drill-down. Other illustrative
pages are not automatically populated from uploads; never turn their mock values into
claims about processed client data. AI reporting output/eligibility remains a separate contract.

Teammate feature branches can contain newer unpublished-to-main interfaces. Inspect their
actual commits before integration; this guide does not merge or certify them. Resolve
compatibility in narrow owner-coordinated changes, preserving contribution attribution.

## Missing V2-to-C1 bridge — not implemented

No exported adapter turns `SemanticVerification.accepted` into C1 or backend transactions.
No example performs such a cast. A separate versioned integration milestone must establish:

1. Supported evidence/policy/schema compatibility and an actual trusted verification result;
   no RECORDED_TEST data may masquerade as live or client-approved output.
2. Complete, truthful dataset/file/worksheet/row/page/region lineage. C1 cannot carry all PDF/image
   geometry today; do not invent `source_row_number`, worksheet or original cells to satisfy types.
3. Fresh execution identity, batch/time/source metadata and identity/reprocessing policy without
   substituting source hashes for backend or economic IDs.
4. A reviewed conversion from nullable experimental financial values to required canonical
   invariants, preserving exact money/IDs/dates, monetary/currency basis, warnings and transformations.
5. Explicit accepted/rejected/unresolved separation, policy/approval evidence, coverage accounting,
   and no silent defaults, reinterpretation or clearing of unknown financial fields.
6. Independent backend validation/security, retention and atomicity; real producer-to-consumer
   tests, negative/fabrication cases, byte/value fidelity and no input mutation.

Any canonical/provenance/financial-policy change is **REQUIRES TECHNICAL REVIEW**. Do not
silently bump schema/ruleset 0.1 or cast V2 records into `IngestionResult` to bypass this gap.

## Verification and known limits

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm build
pnpm audit --json
node --conditions=react-server scripts/ai-increment-03.mjs doctor
node --conditions=react-server scripts/ai-increment-03.mjs evaluate
node --conditions=react-server scripts/ai-increment-03.mjs evaluate --regression
```

Set the existing `FINGENCE_AI_PYTHON` and optional `FINSIGHT_WORKBOOK_PATH` for configured
OCR/6,000-row local verification; keep the academic workbook outside Git. Fixture locations:
`public/samples/ingestion` (26 source rows, 23 accepted); `public/samples/ai-ingestion*`
(four-format synthetic sources); `tests/fixtures/ai-ingestion*` (evaluation-only labels);
`tests/integration/fixtures.ts` (real producer setup). Never rewrite fixture bytes to pass tests.

03B measured 547 passing / 8 skipped with local OCR/workbook configured. Native PostgreSQL
was unavailable; no hosted tests are implied. New handoff examples have their own tests.
Extraction was 87/87 fields on eight original holdout documents, 242/276 on 26 regression
documents. These are not LLM-interpretation accuracy. Six larger regression requests exceed
the conservative quota and remain blocked. Intermittent bounded extraction failures and
the standalone XLSX WORKBOOK_CONTENT/u8 issue remain documented; do not equate a passing
configured Vitest workbook test with a standalone-runtime fix.

The last 03B audit was nonzero: 0 critical, 4 high, 7 moderate, 1 low. Recheck current audit;
do not suppress findings. See [03B evidence](../ai-ingestion/increment-03/verification-03b.md),
[stable contracts](../ingestion/architecture.md), and dated release reports for actual execution evidence.

## Paste into a coding assistant

> Read AGENTS.md and docs/handoff/CURRENT.md before editing. Inspect the actual exported
> interfaces, ownership and tests in this checkout. Reuse the existing ingestion/C1/C2,
> analytics and V2 evidence/materializer/verifier modules instead of rebuilding them.
> Preserve exact money/identifier/date/provenance semantics and owner boundaries. Never cast
> experimental AI records directly into C1 accepted data, IngestionResult or backend transactions.
> Keep independent verification authoritative; no expected-answer injection or recorded/live
> substitution. No provider credentials, live dispatch, paid fallback, hosted migration or
> production-setting changes without specific authorization. Make narrow, testable commits;
> report actual tests, skips and missing contracts. Dated status documents are historical.
