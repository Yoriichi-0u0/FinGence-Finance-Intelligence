# Combined financial intelligence PoC — issue #34

Local, synthetic-only integration of reconciliation PR #33 (`3fa3b7a`) and anomaly/report
PR #32 (`f6f643c`), both descending from PR #29 (`d493c87`). Both parent histories are retained.
No Production activation, hosted migration, new authentication system or model dispatch.

## Run one combined server

Use Node 24.22.0 and pnpm 11.19.0, then `pnpm install --frozen-lockfile` and `pnpm poc:dev`.
Open `http://127.0.0.1:3186/reconciliation`. This launcher enables the existing local M2–M5
stack and PoC routes, refuses hosted/Production execution and strips model dispatch environment
variables. One process opens one `.local/m2-database-v1`; do not open that PGlite directory
from another process while the server is running. Sign in with the existing locally provisioned
active **Finance** membership. Credentials and database files remain private and ignored.
Use the existing M5 enrollment runbook for any additional authorized local accounts;
Finance does not receive Admin access. `/admin` remains role-restricted.

The original supplied files belong in a private dataset directory, never Git:
`demo_bank_statement_mar2026.csv` and `demo_general_ledger_mar2026.csv`.

## Four-minute browser demonstration

1. **Reconciliation:** select both supplied CSVs and process. Bank 175 rows, ledger 177.
   Seven outcome counts: exact 151, date-shift 6, bank-only 7, ledger-only 6, amount-review 4,
   ambiguous-ledger 3, reference-review 4. Inspect each status and an exception's two source links.
   Bank MYR **102,950.56**, ledger **100,434.50**, bank minus ledger **2,516.06**.
2. Download the reconciliation JSON. Source IDs and row/field evidence are preserved; no
   transaction IDs, labels or ground-truth files are used to manufacture matches.
3. **Anomalies:** upload the exact same March bank bytes. Select BUS-001 / 2026-03 / MYR.
   The detector's unchanged rules produce **14 candidates** on this standalone file. Inspect
   their explanations. These are review candidates, not proven fraud or trained-model outputs.
4. Download **PDF** and **JSON evidence** from the management-report section. The report includes
   the persisted seven reconciliation counts and both source movements, with the same bank SHA
   and anomaly net. `/reports` also links to this report. All displayed monetary sums are source
   cash movements, not revenue, profit or a statutory cash-flow statement.

**Measured correction to the issue brief:** 9 candidates describes the March subset when the
entire 6,000-row file is supplied, whose peer groups include other months. The March-only upload
has different median/MAD and counterparty peer populations and yields 14 with the same thresholds.
No detector threshold was changed to force an expected count. The full-file baseline remains
TP 78 / FP 112 / FN 12 / TN 5,798; precision 41.1%, recall 86.7%, specific to constructed
synthetic artefacts. The standalone bank file has no corresponding live precision claim.

## Exact scope and failure contract

`readScopedReconciliation(tx, principal, scope)` performs a read-only lookup in the report's
existing authenticated transaction. Scope includes server-resolved organization, selected
business/period/currency and **the anomaly upload's exact bank SHA-256**. No nested transaction,
client ownership claim or arbitrary selection ID is used. Zero or multiple matching ledger pairs
return unavailable; the report never chooses an arbitrary ledger. The consumer independently
checks scope/hash, row-result counts and signed difference. Database or audit errors propagate
and prevent successful report delivery; they are not disguised as missing reconciliation.

Uploading the full 6,000-row file must show reconciliation **unavailable**, even when selecting
BUS-001 / March with the same net: its uploaded-source SHA differs. Revoked sessions and other
tenants cannot retrieve the source, reconciliation or report. Finance cannot administer users.
Original C1 and experimental V2 contracts remain separate from this source-specific PoC.

## Verification

```sh
pnpm exec vitest run tests/poc-reconciliation tests/poc-anomalies --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm test --maxWorkers=2
node supabase/tests/verify-local.mjs
node supabase/tests/verify-upgraded.mjs
pnpm build
pnpm audit
```

Set `FINGENCE_POC_DATASET_DIR` to the private supplied pack to execute all pack-specific tests.
Configure the existing Python/OCR environment and workbook path for the complete local suite.
Production isolation retains **57** page/method/action probes, both parent UIs' fallback checks,
and deployment artifact/canary scans. A protected hosted Preview is not a public PoC demo.
The existing artifact checker rejects a physical `.local` ancestor; use a source-identical
neutral-path verification build and disclose that existing limitation rather than weaken it.
Actual dated evidence and the short offline browser backup accompany the independent-review ZIP.
