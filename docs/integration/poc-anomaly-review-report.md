# PoC anomaly review and management report (issue #31)

Development checkpoint, 31 October 2026. Stacked on the M1–M5 consolidated candidate
(Draft PR #29, `d493c87`). Synthetic PoC data only; not financial-publication eligible and
not a hosted release. No live model request is made; no hosted database is touched.

## Run (2-minute demo)

```sh
pnpm install --frozen-lockfile
pnpm m5:dev            # http://127.0.0.1:3185/anomalies — rides on the local M5 stack, no extra flag
```

1. Sign in as an active **Finance** member (onboard with the [M5 runbook](v2-m5-tenant-administration.md)).
2. **Upload CSV** → `source_transactions_6000.csv` from the owner-unpacked pack
   (`.local/datasets/poc-2026-03/`, never committed). Choose **BUS-001** and **2026-03**:
   net signed movement **MYR 102,950.56** over 175 rows, 9 review candidates.
3. Open a candidate: the source row (ID, reference, description, amounts) and every rule's rationale.
4. Mark one **Explained** and one **Escalated**; counts update and each decision is audited.
5. **Download PDF** (and **JSON evidence**): same figures, candidate rows, review counts and report hash.
6. Optional: upload `demo_bank_statement_mar2026.csv` (bank layout) — same March net; no precision shown,
   because that file was never evaluated.

Label files (`source_labels_6000.csv`, `demo_anomaly_ground_truth.csv`, `monthly_trends_36.csv`
with its ground-truth column) are refused as input. `/reports` links Finance users to the report.

## What runs

| Piece | Location |
| --- | --- |
| Parser (feature columns only; evaluator files refused) | `lib/poc-anomalies/source.ts` |
| Rules `poc-anomaly-rules-v1` | `lib/poc-anomalies/detector.ts` |
| Read-only `FinancePoCReconciliationV1` consumer | `lib/poc-anomalies/reconciliation.ts` |
| Finance-only service, review decisions, report model | `lib/server/poc-anomalies/service.ts` |
| Fixed-layout A4 PDF (`pdf-lib` 1.17.1, MIT) | `lib/server/poc-anomalies/pdf.ts` |
| API `GET sources|analysis|report`, `POST upload|review` | `app/api/ai-ingestion/m2/anomalies/route.ts` |
| UI | `app/anomalies/page.tsx`, `components/poc-anomalies/*` |
| Local schema `fingence_poc` (sources byte-exact, review decisions) | `supabase/sql/poc-anomalies-local.sql` |

Rules (thresholds fixed before evaluation): duplicate reference within a business; reference
format breaking ≥95% of the business's references; description tag or signed amount contradicting
the direction; minority direction for a counterparty that is one-directional in ≥95% of ≥10 rows;
modified z-score > 3.5 (median/MAD) against the counterparty and direction (≥8 peers) or else the
business and direction, `HIGH` at ≥7; description stating a new or unverified counterparty;
description not naming the recorded counterparty. Category labels, generation metadata and label
columns are never read. Money is exact: integer cents from two-decimal strings.

## Security contract

- Pages and API exist only when `m5RequestAllowed` (local flags + loopback); Production returns 404
  (`scripts/verify-ai-production-isolation.mjs`, 55 probes).
- Organization, role and user come from the HttpOnly session; selection keys are typed and
  allowlisted. Only Finance may upload, read, review or download. Technical/Admin attempts commit
  an `authorization.denied` audit; other tenants' sources are indistinguishable from missing ones.
- Uploads: same-origin POST, ≤5 MiB, `.csv` name, strict UTF-8; stored once per organization by SHA-256.
- Audits (same transaction; failure rolls everything back): `ingestion.persisted` / `ingestion.rejected`,
  `financial_record.read`, `anomaly.reviewed` (new local action), `report.downloaded`.

## Reconciliation integration (Codex, issue #30)

The report quotes a `FinancePoCReconciliationV1` snapshot through an optional
`ReconciliationReader(tx, principal, scope)` passed to `createPocAnomalies`. No producer exists on
this branch, so `pocRuntime` wires none and every report states **"Reconciliation unavailable"**.
The consumer accepts the brief's `results` or issue #30's `items` (not both), requires the exact
organization/business/period/currency, counts equal to row results and `signedDifference = bank − ledger`;
otherwise it reports unavailable. It never matches, repairs or clears outcomes. Wiring Codex's
producer is a one-line change in `lib/server/poc-anomalies/runtime.ts`.

## Evaluation

`tests/poc-anomalies/evaluation.test.ts` (skipped when the pack is absent) computes predictions
from the feature file, then reads the held-out labels and must reproduce
[`docs/poc/anomaly-evaluation.json`](../poc/anomaly-evaluation.json): 6,000 rows, 90 labeled,
TP 78, FP 112, FN 12, TN 5,798 — precision 41.1%, recall 86.7%. The UI shows it only for the exact
evaluated file hash, labeled dataset-specific.

Caveats: the rules were designed from the published anomaly type names, the issue's rule suggestions
and feature profiling (one evaluation run, thresholds untuned). Several rules key on constructed
synthetic artefacts (`DUP-` reference prefix, "UNVERIFIED" in descriptions), so these numbers do not
predict performance on real statements. The external reference baseline (35.9% / 52.2%) came from a
different script; no superiority claim is made beyond this dataset.

## Limitations

- Local synthetic PoC only; no hosted RLS, Production users or audit migration (`anomaly.reviewed`
  is rejected by the hosted CHECK until a reviewed migration).
- Rule statistics use the whole uploaded file for that business (including later months).
- Review decisions attach to (source, row); a re-uploaded identical file reuses them.
- PDF uses standard WinAnsi fonts; other characters print as `?`.
- No reconciliation figures until Codex's producer is integrated.
