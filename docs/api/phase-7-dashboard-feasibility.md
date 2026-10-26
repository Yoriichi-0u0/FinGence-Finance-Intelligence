# Phase 7 — Dashboard summary feasibility and next API assessment

26 October 2026. Assessment only: no dashboard calculation/query contract, HTTP endpoint, schema or teammate implementation is added. The user supplied this development order during Phase 6E: transaction detail → existing API regressions → dashboard feasibility → assess another independently defined API. The proposed “FinGence 2.0 Complete Backend API Plan” dated 26 October is not checked into this repository and is not formally team-approved. This document records the supplied sequence, not a claim that its unseen API catalog is approved.

## Development pause — 26 October 2026

At the user's request, additional backend API development is temporarily paused after final verification and preservation of completed work on `feature/backend-api-celester`. Internal services are not live HTTP endpoints. No new phase starts automatically; resumption requires a new user instruction and the relevant confirmed contracts.

| Area | Recorded status |
| --- | --- |
| Phase 6A–6C | Completed internal transaction-list and batch-list/detail API foundations |
| Phase 6D-A | Completed V2 ingestion readiness assessment; no V2 adapter |
| Phase 6E–6F | Transaction detail and API regression improvements implemented and verified |
| Lecturer demonstration | Local-only synthetic demonstration preserved separately; normal and verbose modes verified |
| Additional APIs | Temporarily paused |
| HTTP API activation | Pending Jason's production authentication, authorization/ownership, cursor security and durable audit integration |
| V2 ingestion integration | Pending Chia's authoritative verified-output contract and reviewed backend/storage mapping |
| Dashboard/analytics integration | Pending Frederick's confirmed definitions, exact arithmetic/read-model contract and independent expected results |
| Reporting integration | Pending Izzat's confirmed reporting/artifact contract and reviewed persistence/publication model |

This pause authorizes no hosted migrations, deployment, merge or implementation of teammate-owned components. Final local verification results remain in the [Phase 6E/F report](phase-6e-transaction-detail.md).

## Phase 7 readiness

Sources: [analytics documentation](../analytics.md), [analytics engine](../../lib/analytics/index.ts), its [legacy ingestion adapter](../../lib/analytics/ingestion-adapter.ts) and [accepted-data adapter](../../lib/analytics/accepted-data-adapter.ts); the current SQL in `supabase/sql/`; the mock-driven `app/page.tsx`; [security foundation](../security/phase-3-security-foundation.md); [V2 readiness](phase-6d-a-v2-ingestion-readiness.md).

The database supplies accepted monetary representations, dates, account identifiers, currency/basis, warning status, batch counts and provenance. It has no confirmed account-to-revenue/expense classification, budget source/model, reconciliation result population, report approval state or authoritative dashboard publication model. Batch ingestion counts already have a defined operational API; they are not financial KPIs.

Frederick's engine implements exact monthly aggregates separated by period/currency/monetary basis, explicit WARNING policy, analytics metrics for already-interpreted period inputs, and provisional forecast/anomaly baselines. These functions do not infer that source amount is revenue, debit is expense, ledger net is cash flow or mixed currencies can be summed. Its `FinancialPeriod` input uses JavaScript numbers, whereas persistence/query APIs preserve exact decimal text: do not introduce an unreviewed conversion to bridge them. The current ingestion adapters are version `0.1`/C1-specific and are not a verified V2 or database adapter.

**Dashboard Summary API is blocked on confirmed business/read-model definitions, even with synthetic security dependencies.** Neither mock UI cards nor a function's existence defines which metrics to expose or which stored records constitute an approved dashboard. Implementing generic raw totals under revenue/profit/cash labels would invent semantics.

## Exact questions for Frederick and the team

| Required decision | Needed before dashboard implementation |
| --- | --- |
| KPI catalog and output contract | Which exact measures, meanings, types/units, null/zero behavior and explanatory provenance? Provide independently calculated synthetic expected outputs |
| Economic classification | Authoritative account/source mapping for interpreted financial inputs, sign conventions and permitted monetary bases; avoid double counting ledger and bank representations |
| Population/lifecycle | Which batches/revisions are included, treatment of superseded/duplicate runs, date basis, period boundaries/timezone and source precedence? |
| Warnings and exceptions | Which WARNING rules remain eligible per measure? REJECTED stays excluded. How should unknown currencies/values or incomplete periods appear? |
| Exact arithmetic | Decimal-safe metric/ratio contract, range, rounding/presentation policy, division-by-zero handling and bridge to existing numeric analytics functions |
| Currency and comparison | Separate currencies versus approved conversion source/rates; comparison periods and absent periods; never sum unlike bases/currencies by default |
| Budget/forecast/anomaly inputs | Source and version of budget/analysis artifacts, model parameters/thresholds and minimum history if those results belong in the summary |
| Publication and presentation | Frederick's definitions, Izzat's dashboard/report consumer contract and Jason's dashboard permission/approval/ownership requirements must agree |

Celester can then implement an independently validated, scoped query/read model and inject the approved analytical calculation boundary, with disposable-database tests and exact synthetic expected results. Real security composition remains a release blocker. No changes to Frederick's code or invented formula are authorized by this assessment.

## Other repository-backed candidates assessed

There is no next independently implementable complete API identified from the current documented contracts. Candidates are assessed below rather than assigning unapproved phase numbers or inventing a roadmap:

| Candidate | Existing facts | Concrete dependency / disposition |
| --- | --- | --- |
| Persistence-attempt investigation/status | Internal `investigateAttempt` exists with a same-primary writer fence and three bounded investigation outcomes. Parent table has only ID, dataset count and creation time | Jason/backend must provide a trusted attempt owner/organization mapping and confirmed operation boundary. A simple SELECT is not equivalent to investigation; no stored job/failed/progress state exists. Preserve existing function and tests; do not expose it or implement a misleading status API |
| V2 ingestion submission/progress | Legacy grouped writer and validated plan exist | Chia's final verified-output/version/completeness/identity contract and separately reviewed storage evolution are missing. Phase 6D-A checklist is the prerequisite, not a cast to `IngestionResult[]` |
| Detailed validation/rejected-evidence retrieval | Warning-only issues reference accepted financial records; batch API already exposes safe category counts | Raw messages/original values are sensitive; no approved ordinary issue-detail DTO/retention permission exists. Rejected evidence is not stored at all. Await Chia's decision/evidence contract and Jason's retrieval boundary rather than fabricate rejected details |
| Reconciliation | UI and mock types exist, as does a proposed security action | No confirmed matching/decision model, authoritative stored reconciliation tables or mutation/concurrency rules. Backend ownership does not authorize invented matching semantics |
| Report listing/generation/download | Mock UI and proposed report actions exist | No persistent report/artifact schema, approval/ownership lifecycle or Izzat-approved producer/consumer contract. Do not turn mock objects into a report API |
| Forecast/anomaly results | Frederick has provisional in-memory baseline functions | No confirmed run/artifact persistence, production output contract, eligibility/model parameters or read permission/retention design. Await Frederick's definitions; do not interpret flags as fraud |
| Auth/user/role/audit APIs | Jason's local security foundation defines proposed actions and event construction | Jason owns implementation and policy; these are not independent Celester tasks |

These missing definitions prevent safe new API implementation; an injected allow function or a speculative DTO would only conceal the dependency. Existing transaction/batch/detail operations remain internal and require real security integration before exposure.

## Recommended next phase

When the user resumes development, obtain Frederick's signed-off dashboard measures/read-model contract and independent synthetic expected values, with Izzat's consumer requirements and Jason's approval/ownership boundary. Record the actual proposed API roadmap in the repository after the user/team provide it. Chia's Phase 6D-B contract artifacts and Jason's reviewed identity/scope/cursor/audit adapters are also pending dependencies. Do not resume an API automatically when an input arrives; wait for the user's instruction. Public endpoints, hosted migrations, deployments and merges remain separately gated.
