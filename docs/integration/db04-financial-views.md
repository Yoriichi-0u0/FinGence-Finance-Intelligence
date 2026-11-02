# Authorized persisted Analytics, Forecasting and Reports

Starting HEAD: 2da3d1eb226c3ba8c24f31b8d42f0e83ae10cd4a.

The existing protected GET /api/db04/processing now derives
`db04-financial-views/1` after the existing authenticated, tenant-scoped read and
audit commit. No new database query, table, migration or public API was added.
Responses retain the same organization, processing ID, BANK/LEDGER SHA256,
business/period/currency, calculation versions and original verification evidence.
The dashboard rejects mismatched analytics/report processing or organization IDs.

The server adapter rechecks accepted VALID/WARNING status, role-bound source
hashes, original signed decimals, raw currency, bank direction/amount/ValueDate,
ledger cash-account debit/credit/PostingDate and common financial scope. Rejected,
missing, contradictory or mixed-context evidence fails closed. It does not
silently drop bad rows and present partial totals as complete figures.

BANK cash inflows, outflow magnitudes and net cash movement reuse the existing
cashTotals implementation and exact BigInt cents functions. Ledger amounts are
not added to bank totals. The only shared calculation change is a type-only
signature widening to the direction/signedAmount fields cashTotals actually uses;
its algorithm and existing caller behavior are unchanged. This avoids inventing
unused SourceRow fields. Exact totals can exceed individual-source amount bounds
and JavaScript safe integers without rounding or Number money conversions.

Deterministic verified-suggestion, unresolved-proposal and unresolved-case counts
are separate from fuzzy/E5 ranking batches and independent verification snapshots.
No AI ranking or eligibility result becomes an approved financial fact. Report
summary `db04-financial-report/1` uses those same cash/count objects, immutable
source evidence, verification status and limitations. It is a source-backed JSON
and HTML summary, not a statutory statement or new PDF generator.

Revenue, expenses, profit, ratios and balance-sheet figures are explicitly
unavailable: the accepted cash contract does not establish those accounting
classifications/balances. Cash movement is never described as business profit.

Forecasting reuses forecastBusiness and its unchanged poc-cash-forecast-v1 policy.
DB04 currently binds one verified calendar month per source pair, while the
existing algorithm requires at least seven consecutive observed months for its
six-month baseline/backtest. The response therefore reports UNAVAILABLE /
INSUFFICIENT_HISTORY with actual one-month history. Missing months, balances and
predictions are never manufactured, and separate jobs are not pooled as history.

The protected local workspace now has Analytics, Forecasting and Reports tabs
alongside Transactions/Reconciliation, all using one returned context. The three
corresponding pages opt into this workspace only in development with
FINGENCE_DB04_LOCAL=1, no VERCEL, and existing loopback/origin checks. Production
page branches remain intact. Retrieval failures clear results, with no browser
demo substitution. Session credentials stay in memory as before.

## Executed verification

- Relevant backend/security/ingestion/reconciliation/insights/forecast run:
  672 passed, 0 failed, 14 existing skips (outputs/db04-ai06/financial-views.json).
- Final focused run and exact total-bound guard: 96 passed, 0 failed, 0 skipped,
  including 26 native PostgreSQL tests (financial-views-release.json).
  Runs overlap; do not sum their counts.
- Native tests use real PostgreSQL and a real Next server, upload registered
  fixture bytes, retrieve matching analytics/report IDs/hashes and unavailable
  forecast, deny cross-organization reads, and visit all five local pages.
- Existing native tests exercise RLS, reconnect, duplicates, rollback and AI06
  evidence preservation. Adapter tests cover signed cash totals, huge decimals,
  source/context rejection, refused accounting metrics, report/forecast labels
  and Production demo selection even with the local flag set.
- Typecheck, focused lint and server-boundary checks pass. No browser-click
  automation was run; rendered-component and live HTTP tests are distinct claims.
- Full project suite not rerun; previous 30 baseline-reproduced failures remain
  disclosed. Existing forecast algorithms/evaluation and frozen AI research are
  unchanged. No improved forecast or reconciliation accuracy is claimed.

General C1/V2 reconciliation still needs a proven trusted-role/date/provenance
mapping; no cast was invented. Hosted Supabase remains unverified. No main or
teammate branch, Production database/authentication, Vercel configuration or
Production demo behavior changed. Draft PR #57 remains unmerged.
