# AI04 independent financial verification

Research-only deterministic post-ranking verification, version `ai04/1.0.0`, policy `ai04-policy/1.0.0`. It surfaces suggestions for review; it never approves, posts or writes a transaction.

## Entry points and evidence boundary

`project(source)` builds a deep-frozen verification projection from the AI01 M2 training or development input. The source-only adapter rejects extra fields and removes descriptions. It retains exact amount strings, source signed/debit/credit values, date basis, source identities, synthetic lineage, eligibility, reference and counterparty. It does not import the AI01 validator, generator or annotations. The frozen ranking feature payload is unchanged.

`verify(input, proposals, POLICY)` recomputes financial checks independently of AI02 and AI03. Proposals contain exactly bankId, ledgerId, algorithm and topology. Scores, upstream support flags, inferred financial fields and labels are rejected. Each algorithm's complete proposal batch is verified separately. An empty batch is valid and makes no correctness claim.

`evaluation.ts` consumes labels only after verification. `experiment.ts` reads the preserved E0/E1/E2b training/development outputs, projects source evidence, verifies each algorithm/split separately and evaluates decisions. Neither module is imported by the runtime verifier. There is no held-out loader, model initialization, threshold tuning or external service call.

## Frozen policy

| Check | Rule |
| --- | --- |
| Identity and scope | Both records exist, BANK/LEDGER roles, distinct IDs, unique record/source-row identities and source transaction identity within a system/account. Complete M2 cohort: all 25 rows for every declared split template. |
| Source evidence | Source system, account, role, monetary basis, file/sheet/row and canonical-date basis agree with the existing repository's synthetic schema declarations. Eligibility must be SYNTHETIC_RESEARCH_ELIGIBLE. |
| Exact money | Positive valid decimal strings; reviewed BigInt decimal equality. No Number conversion, rounding, FX, tolerance or aggregation. Null, zero and malformed values are not accepted as positive money. |
| Basis | Independently recompute existing SIGNED_CASH, SIGNED_EXPENSE, AMOUNT_DIRECTION, CASH_DEBIT_CREDIT and restricted EXPENSE_DEBIT_CREDIT conventions. Unused columns remain null. |
| Currency/direction | Known synthetic currencies MYR/USD and explicit INFLOW/OUTFLOW must agree. A bank debit is not assumed equal to an expense debit. |
| Dates | Valid ISO calendar dates, split period, declared transaction/posting canonical basis, inclusive two-day canonical-date gap. This experimental policy is not an approved SAIC tolerance. |
| Identity evidence | Both references and counterparties must be present and equal after NFC plus outer-whitespace trimming only. Preserve case, punctuation and internal spaces. Conflicts mean unverified identity, not proof that differently spelled entities are distinct. |
| Competition | Any alternative on either side whose amount/currency/direction/date checks do not definitively fail makes the proposal unresolved. Unknown financial evidence remains a possible competitor. Even a differing reference does not justify choosing among plausible partners in this version. |
| Assignment | Reused bank or ledger IDs, including duplicate identical proposals, withhold all conflicting proposals. No first-wins or ID tie-break. |
| Topology | PAIR only. GROUP/PARTIAL remain unresolved; no sums or inferred grouping. |

This cohort policy is deliberately tied to `ai01-m2/1.1.0`; it is not a universal row-count rule for later datasets. It prevents a caller presenting only a ranked shortlist as the entire ambiguity scope. Source templates validate individual records; they do not supply economic pair membership. All split records are considered for competition, without using block IDs or hidden relationship identifiers.

Synthetic provenance/eligibility checks establish agreement with repository fixtures, not authenticity of externally supplied documents. A production account-to-account authorization map, producer V2 eligibility contract, trusted provenance and approval authority are unavailable and remain unverified outside this synthetic scope. Do not use this entry point as production authorization.

## Decisions and fail-closed behavior

Each decision retains IDs, algorithm, verifier/policy versions, per-check PASS/FAIL/NOT_VERIFIED states, source-ID evidence references, reason codes and final disposition. Exact amount, currency, direction or canonical-window incompatibility yields BLOCKED_PROPOSAL. Missing, malformed, conflicting, ambiguous or unsupported evidence yields UNRESOLVED_REVIEW. Only all passing checks yield VERIFIED_SUGGESTION.

An invalid envelope, extra field, unsupported split, injected score/truth or missing/changed policy throws before returning suggestions. Per-record invalid evidence is reported as NOT_VERIFIED where its shape can be evaluated. A caller must treat exceptions as no verified output. No input is silently repaired. The adapter's identity normalization is the explicitly documented exception for string comparison, without source mutation.

Fingerprints use canonical JSON and SHA-256 and bind the full ordered projection, proposal batch, policy and decisions. No clocks enter fingerprints. Identical inputs reproduce identical evidence; reordering input arrays changes the bound input representation but does not choose a different partner. Source and proposal arrays are not mutated.

## Reproduction on Windows

From the existing repository with its approved dependencies installed:

```powershell
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
$env:AI03_REAL = '0'
$env:AI02_WRITE_EVIDENCE = '0'
$env:AI04_WRITE_EVIDENCE = '1'
pnpm exec vitest run tests/reconciliation/ai04.test.ts tests/reconciliation/ai04-evaluation.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai04/focused-tests.json
# Normal test mode preserves all measurement files:
$env:AI04_WRITE_EVIDENCE = '0'
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai04/regressions.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai04 tests/reconciliation/ai04*.ts --max-warnings=0
node research/reconciliation/ai04/verify.mjs
```

Evidence-writing mode intentionally changes only AI04 results and test evidence. Rerunning it changes latency samples and requires refreshing the AI04 evidence manifest. It never writes historical AI01–AI03 results. The full suite uses the existing disposable local PostgreSQL harness and synthetic data. The DB03 Vitest configuration disables environment-file loading.

The independent-review ZIP overlays this repository. It excludes raw input records, truth sidecars, model/runtime/cache files and database dumps. Required existing input/evaluation files are identified by hash in the manifest's externalInputs section and remain in the original repository. No standalone inference or installation is needed.
