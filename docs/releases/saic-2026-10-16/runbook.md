# SAIC consultation runbook — 16 October 2026

Use only published synthetic data. Open **Data**, not the illustrative Overview, for the working demonstration. Keep the verified browser session and local production build ready before the meeting.

## Eight-minute live demonstration

1. **Chia (introduction and ingestion):** FinGence addresses structurally different financial files. Explain provisional accounting conventions and the current browser-memory boundary.
2. Open **Try an example — synthetic data only**, load **ledger CSV**. Check the original profile and account code `00100`; confirm separate Debit/Credit columns and Posting date. Checking is disabled until the review checkbox is confirmed. Check and add: 10 Ready.
3. Load **bank XLSX**. Explicitly choose **Transactions**. Explain that suggestions require review. Correct **Details → Reference** to resolve the duplicate Description mapping. Review non-negative amount plus Debit/Credit label and Transaction date, then approve/check: 8 Ready.
4. Load **edge cases**. Review signed source amount, Transaction date and unused column; approve/check. Show **2 Ready, 3 Included — needs attention, 3 Cannot include**. Review source row 7 (`31/31/2026`) and original/standardized values; expand Technical row evidence if requested.
5. Show combined **26 checked / 20 VALID / 3 WARNING / 3 REJECTED / 23 accepted**. Download included CSV, excluded problems CSV and full evidence JSON. The problem report contains four issues across three rejected rows.
6. **Frederick (actual analytics):** Step 7 consumes the real C1 producer. Show 23 analyzed rows and change WARNING policy to exclude: 20 analyzed, still 23 accepted for ingestion. Return to include. Explain separate monthly source sums: MYR ledger debit `2129.4`, credit `403.55`; MYR bank amount `2345.75`; signed MYR `249`; unusual currency `MYRR` `19` remains visibly separate with its warning. These are not revenue, expenses or net cash flow. Ledger interpretation is unavailable.
7. Show two statistical amount flags, ledger source row 2 and bank source row 3, both magnitude 1500. Review source references and warnings. Explain the exact median/MAD baseline, not trained ML or fraud findings.
8. **Chia + Frederick:** Recheck a dataset. Show a new producer batch and unchanged 23 accepted rows. Edit a reviewed setting to remove the affected dataset: analysis immediately falls to 18 for the remaining ledger/bank; reapprove/check restores 23. Loading an identical file reuses existing results without a fresh execution.
9. **Celester (local persistence):** In a local terminal run `pnpm demo:persistence`. The test applies SQL only to a disposable PGlite database and reads actual counts: one attempt, three child batches, 23 financial records, three warning issues. Explain atomic rollback, COMPLETED_EMPTY, and unknown-COMMIT investigation. Hosted persistence is not connected to the public UI.
10. **Jason (security foundation):** Run `pnpm test:security` and `pnpm check:server-boundary`, or show the recorded results. Explain verified-principal prerequisites, organization/role policy, identifier-only audit events and missing authentication/operational audit service. Do not claim the public PoC has secure real-client uploads.
11. **Izzat (frontend / consultation discussion):** Demonstrate navigation and mobile layout; distinguish illustrative dashboard screens from the actual Data results. Confirm dashboard requirements for the next increment without attributing unpublished implementation.

## Offline fallback

The integration checkout has installed dependencies and a verified production build. Before losing internet, run `pnpm start --port 3101` under Node 24 and open `http://localhost:3101/data`. Sample files are local application assets; the live workflow requires no database credentials or external APIs. Browser fonts were fetched during the build, not at demonstration time.

Keep the source checkout, toolchain, verification logs, downloaded synthetic reports and rehearsal screenshots together in the local release workspace. The accompanying offline launcher runs the already-built application without installing anything. If the browser cannot run, use the saved screenshots, accepted CSV/evidence and actual local persistence output. Describe evidence as recorded execution, not a live network operation.

A protected Vercel preview requires the presenter's existing authorized Vercel session; do not disable deployment protection for the meeting. Production is only the URL whose deployed commit was verified against the released personal main.

## SAIC questions — record answers after the meeting

- Who will use FinGence first, and which workflow/source should be prioritized?
- Which exact accounting export formats, mandatory identifiers and reconciliation rules apply?
- Should records be organized by transaction date or posting date for each source?
- What do source Debit/Credit labels mean? What ledger conventions can support interpreted metrics?
- Which currencies and number/date formats must be supported?
- Which warnings may be accepted, and which should block downstream analyses?
- What does SAIC expect next: reconciliation, analytical features, forecasting or reporting?
- What retention, access-control and audit requirements apply before using real records?

No client feedback is invented by this runbook. Capture actual decisions for the Sprint 01 consultation record.
