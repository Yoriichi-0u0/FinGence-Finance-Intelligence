# Local synthetic bank / GL reconciliation — Issue #30

Based exactly on consolidated PR #29 at `d493c872a48fc13d9391abcfc123f70811eb9103`.
This is a deterministic local PoC, not model accuracy, hosted persistence or Production accounting.

## Run and demonstrate

Use Node 24.22.0 and pnpm 11.19.0 in this feature checkout:

```sh
pnpm install --frozen-lockfile
pnpm poc:dev
```

Open `http://127.0.0.1:3186/reconciliation`. This launcher binds loopback, removes provider
credentials/dispatch variables from the child environment, and enables the existing M2–M5
local identity/database stack plus `FINGENCE_POC_LOCAL=1`. It uses this checkout's own
`.local/m2-database-v1`; never run two processes against that directory.

Sign in with an existing local **Finance** account. If a new checkout needs an account,
stop its server and use the existing `pnpm m3:account` OS-local provisioning command with
`M2_LOCAL_EMAIL`, `M2_LOCAL_PASSWORD`, `M2_LOCAL_ORGANIZATION` and `M3_LOCAL_ROLE=Finance`.
Read the password at a hidden shell prompt; never put its value into shell history or Git.
M5 enrollment/admin workflows remain available for local organization management.
No hardcoded account or browser-supplied user/organization/role is used by reconciliation.

Two-minute walkthrough:

1. Select the supplied `demo_bank_statement_mar2026.csv` and
   `demo_general_ledger_mar2026.csv` from the owner's ignored PoC dataset folder.
2. Click **Process both sources**. The server validates both byte hashes, CSV schemas,
   dates, cash direction and exact amounts before one audited atomic persistence transaction.
3. Inspect 175 bank rows / 177 ledger entries and the seven outcome cards. Inspect an
   amount, reference or duplicate exception: both original source/evidence links remain visible.
4. Download JSON. Its exact cash-account source totals are MYR **102950.56**, **100434.50**
   and signed bank-minus-ledger **2516.06**, calculated from the uploaded records.
5. Navigate away and return, reload, or re-upload the same pair: retrieve the same stored
   source-pair ID. Sign out in another tab: financial display clears on session recheck.

Only the exact supplied synthetic input bytes are registered for HTTP ingestion. Rename
the files if needed, but do not edit their content. Different files are refused, not silently
treated as supported layouts. A pair is unique by organization and both file hashes.

## Authoritative shared interface (Codex / Claude)

Import types from `lib/poc-reconciliation/contracts.ts`:
`FinancePoCReconciliationV1`, `ReconciliationStatus`, `CashSourceRow`, `CashEvidence`.
The agreed `version`, `origin`, `scope`, `sources`, `cashMovement`, `counts`, `results`,
`limitations`, and row-level evidence fields are retained without renaming.
Additive `rows` and `evidence` provide source drill-down. They are PoC cash-source records,
not C1 accepted data, V2 machine-verified records, revenue, profit or closing balances.

Reporting can consume the snapshot as an optional read-only input. Use the existing
authenticated cookie with `GET /api/ai-ingestion/m2/reconciliation` (saved selections),
`GET ...?id=<selection>` (snapshot), or `GET ...?id=<selection>&download=1` (JSON attachment).
`POST` takes exactly two multipart File fields, `bank` and `ledger`; it accepts no identity,
verification or financial JSON claims. The internal service is
`createReconciliationService(database).get(sessionToken, selectionId, download?)`.
All reads and writes resolve the current Finance membership and active organization,
scope by persisted organization ownership, and require a committed audit before delivery.
Technical (Management) and Admin have no implicit financial access.

Claude owns anomaly rules and report layout (#31); this slice supplies the reconciliation
snapshot and JSON export only. Do not import the offline scorer into an app/API module.

## Matching and provenance

- Bank Credit adds cash / Debit removes cash; GL cash-account Debit adds cash / Credit
  removes cash. These are explicit conventions of the supplied schemas, not general P&L.
- Match only a unique reference in both sources with equal currency and signed cents,
  on the same date or within two calendar posting days. No fuzzy auto-match.
- Amount differences, duplicate reference groups and unique same-date/amount candidates
  with different references remain review outcomes. Opposite signs never match.
- Whole reference groups are evaluated before consumption. No order-dependent first match,
  one-to-many clearing or cross-source SourceTransactionID join is used.
- Source IDs are byte SHA-256; evidence IDs bind source hash, original CSV record number
  and column. CSV record numbers include the header, not physical text-line offsets.
- The current narrow schema supports MYR, cash account `1000-BANK`, one business and one
  calendar month per source. Mixed currencies/businesses/months are refused explicitly.

## Evaluation and verification

```sh
pnpm exec vitest run tests/poc-reconciliation
node --conditions=react-server scripts/poc-reconciliation-evaluate.mjs /path/to/poc-2026-03
pnpm test --maxWorkers=2
pnpm lint
pnpm typecheck
pnpm check:server-boundary
node supabase/tests/verify-local.mjs
node supabase/tests/verify-upgraded.mjs
node tests/persistence/schema-compatibility.mjs
pnpm build
pnpm audit --json
```

Configure the known-good Python on `PATH` (some existing tests invoke `python3` directly)
and `FINGENCE_AI_PYTHON`; set `FINSIGHT_WORKBOOK_PATH` to the preserved canonical workbook.
The offline evaluator computes and freezes results **before** opening scoring labels.
No ground truth, expected-results file, category label or source-label file is read by runtime
normalization, matching or persistence. The constructed benchmark is not an ML evaluation.
Algorithm design was informed by the supplied open-source evaluation handoff's reference
matching/ambiguity rules; no third-party application or Python engine was vendored/executed.

Production-mode isolation must deny the new API GET/POST even with all local flags set,
and keep `/reconciliation` on its unchanged illustrative fallback. The existing artifact
checker classifies any `.local` ancestor as private, including a worktree's own build root;
retain that failure evidence and verify an identical committed tree in a neutral temporary
directory rather than weakening the checker.

## Failure recovery and limits

On lost/invalid upload response, use **Refresh saved sources**. There is no automatic retry.
Database uniqueness prevents a second persisted pair even after an uncertain response.
No result is delivered when its audit fails; the write rolls back. Do not manually edit the
database or replace its files to make a demo pass. On server failure, stop this launcher,
preserve its `.local` state and restart the same checkout; the persisted source pair survives.
Real hosted authentication, hosted tenant ownership, ML matching, live AI and broader
multi-period/currency layouts are outside this PoC. Legacy `/data` and Production are preserved.
