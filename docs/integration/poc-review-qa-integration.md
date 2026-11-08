# Combined Finance review and source questions — Issue #49

Local synthetic university PoC. Both reviewed histories are retained: PR #48
`1011035132524ecdccebb465a4b32270b1eda095` and PR #47
`4be7e755798dceb0aeb802270d11ec5cbe030f4e`, based on PR #43
`dca0534af77166a051be84e18af1977c680de2d0`. Preserve #43 as the fallback.
No main merge, hosted database activation or live inference is part of this integration.

## Run

Use Node 24.22.0 and pnpm 11.19.0 in this integration checkout:

```sh
pnpm install --frozen-lockfile
FINGENCE_POC_PORT=3194 pnpm poc:dev
```

Open `http://127.0.0.1:3194/reconciliation` using the existing privately provisioned
local Finance account. The launcher's one process owns this checkout's local database.
Do not share a live PGlite directory with another process. The PR #43 fallback remains
on its separate checkout, database and localhost:3190 origin. No credentials belong in
this document, screenshots or a review archive.

## Journey A — March bank and ledger

1. Process the supplied March bank and ledger CSVs. Check 175/177 source rows,
   181 outcomes and categories 151/6/7/6/4/3/4. Signed bank movement MYR 102950.56,
   ledger 100434.50, bank-minus-ledger difference 2516.06.
2. Inspect one amount mismatch, save Explained with an explanation; inspect one
   duplicate ambiguity, save Escalated. Refresh/sign back in. The 24 original
   reconciliation exceptions remain unchanged; separate human states become
   Open 22 / Investigating 0 / Explained 1 / Escalated 1.
3. On Anomalies, upload the same March bank CSV: 14 candidates. Inspect rule explanations.
   Generate the management PDF and JSON. Both must quote the same exact bank source,
   original reconciliation categories and monetary difference.
4. Open Finance questions. It is visibly **rule-based, not live AI**. Select that bank
   source, BUS-001 / 2026-03 / MYR. Ask difference, matches and records to review.
   Q&A distinguishes original exceptions from current human annotations. Explained
   never means matched or cleared. Net profit is refused; next-month forecasting
   is unavailable for a source with only one month.

## Journey B — full 6,000-row source

Upload `source_transactions_6000.csv` on Anomalies and select BUS-001 / 2026-03 / MYR.
Transactions, Analytics, report and Q&A use that source's SHA, not the March-only upload.
Check 12 observed months and 9 March anomaly candidates. Reconciliation and its human
annotations must be unavailable despite equal March totals. The next September 2026
six-month statistical baseline is receipts 205774.83, payments magnitude 129113.73,
derived net 76661.10 MYR. Retain the low-confidence caveat: pooled net WAPE 52.85%
versus 46.90% for repeating last month. Source/business/month changes clear old answers.

## Integration contract

Finance Q&A retrieves the existing review aggregate inside its authorized/audited read
transaction, after resolving a unique immutable reconciliation for the bank source.
Lookup binds saved ID, organization, both source hashes, business, period and currency.
Answer composition validates that identity and the aggregate coverage/counts again.
No eligible original outcome is removed because it was Explained or Escalated.
Report PDF/JSON deliberately retain the original reconciliation contract; human review
annotations are shown separately in Reconciliation and Q&A, not silently added to PDFs.
All 69 Production probes and both server-boundary additions remain intact.
