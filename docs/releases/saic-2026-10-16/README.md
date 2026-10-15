# FinGence — SAIC consultation release candidate, 16 October 2026

Implementation and local verification: 15 October 2026. Shared-main publication requires a non-author team approval on the integration PR and passing checks. This document does not assert that a release candidate has already been merged or deployed.

## Contribution provenance and integration changes

| Owner | Published source | Included work and integration changes |
| --- | --- | --- |
| Chia | `feature/data-ingestion-chia` `161b489d2758160f46d6f8252dc866b595102735`; personal reviewed checkpoint `c32216e191706d1e4c6f80c57165f160bb70bc77` | Reused identical core ingestion and exact fixtures. Selectively added reviewed C1/C2, C3-I0 manifest/guard, B1/B2 UI and FinGence branding. Data uses fresh execution context. |
| Frederick / Xinyr | `feature/analysis-reconciliation-fred` `bc8be6b779e2507dcc87f5adb5d1f66a3694c626`; original C1 adapter commit `9781b313946445f7247e7ad768867383de8389a3` | Integrated analytics utilities and retained `analyzeIngestionResults`. Repaired C1 adapter to import the actual producer type; reconstructed actual provenance; added analysis-specific interpretation availability. Fixed even-sized median arithmetic with independent regression evidence. |
| Celester / jiaqi538 | `features/backend-celester` `b8dafae640c240e8b9bd216bbc19ba19e0a0057f` | Integrated internal grouped persistence, SQL migrations and tests. Connection release now preserves acknowledged/unknown/rollback outcomes. Ported Windows basename handling; wired local verifiers to pinned PGlite and recognized the exact SQL RESTRICT error in the negative test. No hosted schema changed. |
| Jason / Jas0one | `feature/cybersecurity-jason` `00a7df6a27111798fa82a5059c276adb331a4018`; helper commit `eefa60a09968d5dfeb69e033ba5a6142af1e1899` | Integrated server-only policy/audit-event helpers and tests. Combined real server-boundary checks; removed an unused lint-suppression comment only. No operational authentication or audit sink added. |
| Izzat | No separately published source was found in the inspected branches | Existing frontend retained. No new attribution is assigned to another member's implementation. |

The team root remains a Next.js application; no standalone backend/security root replaced it. PR #1 remains historical ingestion context, not a substitute for this integration PR.

## Implemented versus pending

| Capability | State and demonstrated boundary |
| --- | --- |
| CSV/XLSX → profile → explicit reviewed mapping/conventions → checks | LIVE in the Data page; browser memory only |
| 26 synthetic rows: 20 VALID, 3 WARNING, 3 REJECTED | VERIFIED; 23 accepted, rejected evidence separate |
| C1 accepted transport → analytics | LIVE, using `createAcceptedDataPayload()` directly; schema/ruleset `0.1` unchanged |
| Reprocessing and stale-result removal | LIVE; C2 creates fresh batch/time for each execution; analytics derives from current results only |
| Exact source-value monthly summaries | LIVE; currencies and monetary representations separate; no universal amount/cash-flow/net-profit metric |
| Statistical anomaly baseline | LIVE; median/MAD, threshold 4.5, minimum 5 comparable records; two flags for the published fixtures; not fraud detection or trained ML |
| Interpreted ledger net | UNAVAILABLE by default. C1 has no ledger-interpretation approval metadata. An optional associated analysis convention can establish exact debit-minus-credit arithmetic only; partial availability never yields a complete-looking net total. |
| Grouped persistence | VERIFIED LOCAL ONLY: one transaction, one attempt, three batches, 23 accepted records, three warning issues; no rejected financial records |
| All-rejected / zero-accepted batches | Local service/tests retain COMPLETED_EMPTY metadata; header-only files remain unsupported by the ingestion reader |
| Unknown COMMIT | Retain preallocated attempt UUID and investigate on the same primary; no automatic retry |
| Hosted Supabase | PENDING. Celester project `fhipzomczevbpybezzxu` returned a connector permission error; no hosted schema/data was changed. An unrelated connected project is not reused for financial data. |
| Security policy / audit event creation | TESTED SERVER HELPERS; not authentication, membership verification, persistent audits or operational RBAC |
| Other dashboard/forecast/reconciliation/report pages | ILLUSTRATIVE; explicitly labelled, not populated from uploaded files |
| Backend supersession / changed-file replacement | PENDING backend lifecycle/integration; no filename-based guessing |
| Production release | Requires verified shared approval, personal-main release and matching Vercel source commit. Candidate/preview must not be described as production. |

## Decisions and financial safeguards

- C1/C2 producers, canonical schema/ruleset `0.1`, exact decimal and identifier strings, separate dates and reviewed conventions are unchanged.
- The C1 analytics adapter does not fabricate `derived_ledger_net` to satisfy `CanonicalTransaction`. Its records use an analysis-specific source shape; interpretation is separate.
- Existing canonical ledger arithmetic is a convenience, not revenue, expenses or universal cash flow. No ledger convention is inferred from filenames or bank Debit/Credit labels.
- Full trusted `IngestionResult[]` goes to Celester's internal grouped service. Reduced C1 data is not falsely passed as the same contract.
- The live browser demonstration makes no persistence/API request. Financial files remain in browser memory. Only synthetic examples may be used on the public PoC while authentication is incomplete.
- pg/server-only and PGlite test dependencies are pinned to the teammate's reviewed versions. Existing application package resolutions were retained. Node 24 is explicit; tests use all `tests/**/*.test.ts` suites.
- CI audit output is visible and non-blocking for the documented existing backlog. No advisories are suppressed, forced overrides added, or dependencies broadly updated.

## Verification

See [verification.md](verification.md), [runbook.md](runbook.md), and the original [ingestion verification history](../../ingestion/verification.md). Historical records are not rewritten as current integration evidence.
