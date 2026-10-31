# AI04 independent financial verification — engineering report

30 October 2026, Asia/Singapore. AI04 is implemented locally and ready for independent research review, subject to the limitations below. Verifier `ai04/1.0.0`; research policy `ai04-policy/1.0.0`; dataset `ai01-m2/1.1.0`. No production approval follows from these synthetic results.

## A. Repository state

Repository: Yoriichi-0u0/FinGence-Finance-Intelligence. Local checkout: `C:\Users\celes\Downloads\COS40005 FYP\FinGence-Finance-Intelligence`.

Branch remains `feature/backend-celester`, upstream `origin/feature/backend-api-celester`, HEAD `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca`. No branch switch, staging, reset, commit, push, merge, PR edit or deployment occurred.

The pre-existing tracked modification is `scripts/db03/run.mjs`. Three pre-existing untracked DB03 evidence directories remain: `2026-10-27T12-52-50-072Z`, `2026-10-27T12-55-58-853Z`, `2026-10-27T13-09-48-952Z`. Research, reconciliation tests and documentation were already untracked. AI04 adds files within those existing directory groups. The architecture assessment, preliminary DB01 artifacts and local exclusions were preserved. No existing file was intentionally edited; final byte-preservation results are in checks.json.

AGENTS.md, AI01 M2 schema/access/financial contracts and specifications, AI02 candidate/resolution/evaluation modules, AI03 interfaces, actual recorded outputs, pinned model configuration and testing infrastructure were inspected. The Next.js guidance was read; AI04 introduces no Next.js or ingestion changes. No production environment files, hosted Supabase, existing developer database or real financial data were accessed.

## B. Implementation and data boundary

The runtime is isolated under `research/reconciliation/ai04/`. Its source-only projection retains exact financial values, raw monetary representation, source lineage, eligibility, canonical-date basis, reference and counterparty. It removes descriptions and rejects extra fields. Projected values are deeply frozen; verification does not mutate callers' sources or proposals.

The verifier imports the reviewed exact-decimal helpers and the existing synthetic schema declarations. It does not call AI02's blockedReason, trust upstream support/confidence or import the model worker, embedding code, generator, annotations or evaluator. Template metadata validates each record's role/system/account/basis/lineage, never economic pair membership. There is no use of scenario family, block membership or hidden economic IDs.

Proposals contain IDs, algorithm and topology only. Injected confidence, support, financial attributes or truth fields are rejected. Labels enter only the separate evaluator after decisions exist. Replay reads the already measured E0/E1/E2b training/development runs, without loading the model or changing a threshold, baseline or label. AI04 has no held-out loader.

## C. Verification policy and reasons

| Area / reason codes | Enforcement and disposition |
| --- | --- |
| RECORD_EXISTENCE, DISTINCT_ROLES | Both records must exist, be different and have BANK/LEDGER roles. Missing or invalid evidence is unresolved. |
| SOURCE_IDENTITY, UNIQUE_SOURCE_IDENTITIES, SOURCE_TRANSACTION_ID | Nonempty stable record/system/account/source-row identities, trusted synthetic schema agreement, unique rows/IDs and no reused source transaction ID within system/account. A source transaction ID may be null under the existing contract; it is not economic matching evidence. |
| COMPLETE_SYNTHETIC_SCOPE | Full version-specific cohort with 25 rows per split template and valid source checks. A ranker's shortlist cannot establish uniqueness. All split records are considered for competition. |
| SYNTHETIC_PROVENANCE, SYNTHETIC_ELIGIBILITY | File/sheet/row, synthetic flag and SYNTHETIC_RESEARCH_ELIGIBLE must agree with existing schema declarations. Missing or incompatible evidence is NOT_VERIFIED, never silently accepted. |
| MONETARY_BASIS | Recompute signed cash, signed expense, amount/direction, cash debit/credit and restricted settled-expense debit/credit conventions. Check active amount and unused null columns. These remain provisional synthetic conventions. |
| EXACT_AMOUNT | Positive valid decimal strings compared with BigInt-based exact arithmetic. Compatible decimal scales are allowed; no Number monetary equality, rounding, tolerance, FX, partial sum or aggregation. Valid unequal amounts block. Null/zero/malformed amounts remain unverified. |
| CURRENCY, DIRECTION | Known MYR/USD and explicit INFLOW/OUTFLOW must agree. Definitive incompatibility blocks; unavailable or unknown values remain unverified. |
| DATE_BASIS, CANONICAL_DATE_WINDOW | Preserve transaction/posting/canonical distinctions. Validate ISO calendar dates, split period and declared canonical basis. Inclusive two-day canonical window is an experimental policy, not a client-approved tolerance. Definitive window violation blocks. |
| REFERENCE_AGREEMENT/MISSING/CONFLICT; COUNTERPARTY_AGREEMENT/MISSING/CONFLICT | Both must agree after NFC plus outer whitespace trimming only. Case, punctuation and internal spaces remain significant. Missing/conflicting identity evidence withholds, without claiming distinct legal entities from different spellings. |
| UNIQUE_FINANCIALLY_PLAUSIBLE_PARTNER | Any alternative on either side not definitively excluded by independent financial/date checks makes the proposal unresolved, even if an alternative reference differs. Unknown financial evidence is a possible competitor. No ID ordering or semantic score resolves it. |
| PAIR_TOPOLOGY, UNIQUE_ASSIGNMENT | GROUP/PARTIAL are unresolved. Reused bank/ledger assignments, including duplicate identical proposals, withhold all conflicts. No first-wins selection. |

Any definitive financial FAIL produces BLOCKED_PROPOSAL. Otherwise any NOT_VERIFIED produces UNRESOLVED_REVIEW. All checks must pass for VERIFIED_SUGGESTION. Invalid input shape, forbidden fields, split or policy fail before returning suggestions; callers must treat exceptions as no verified output. Every decision retains algorithm, IDs, verifier/policy version, individual checks, evidence references and reason codes. None of these outcomes confirms or posts accounting entries.

Synthetic source checks establish consistency with local fixture declarations. They cannot authenticate an external document, prove production account eligibility or approve client accounting conventions. Those fields remain unverified outside this explicitly bounded research scope. No unavailable production authority was fabricated to obtain a passing result.

## D. Actual matching and safety results

Combined train/development results, denominator 64 genuine PAIR relationships and 100 bank records:

| Method | Original TP / explicit FP | Verified TP / explicit FP | Correct pairs withheld | Verified precision | Recall | F1 | Bank coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 | 28 / 0 | 18 / 0 | 10 | 100% | 28.125% | 43.902% | 18% |
| E1 | 32 / 0 | 18 / 0 | 14 | 100% | 28.125% | 43.902% | 18% |
| E2b | 34 / 4 | 18 / 0 | 16 | 100% | 28.125% | 43.902% | 18% |

Each method has 46 false negatives and 82 unresolved bank records after verification. Twelve train and six development genuine suggestions remain. The original E5 result remains 34 TP, four FP, 89.47% precision, 53.125% recall and 66.67% F1. No historical measurement was replaced by the AI04 result.

All eight known E5 risks are withheld. Verified suggestions have zero observed amount, currency, direction, date, identity, duplicate assignment, grouping, authored-abstention, forced-ambiguity or unmatched-record violations. No unannotated suggestions remain. The original upstream runs already had zero financial blocking violations; adversarial forged proposals were tested independently of that fact.

This is an observed precision-versus-coverage tradeoff, not evidence of universal financial correctness. AI04 retains useful nonzero coverage, but withholds 16 correct E5 pairs. E5's two additional genuine multilingual matches over E1 are both withheld for insufficient reference/competition evidence. Its semantic gain is preserved in the pre-verification comparison rather than reclassified as false economic truth. No description/score override was introduced to recover coverage.

Precision uses explicitly assessed TP/(TP+FP). Sparse unannotated suggestions are separate; empty/wholly unassessed precision is null. Pair recall excludes GROUP/PARTIAL relationships, and coverage includes all bank records. Economic pair labels and operational abstention decisions remain separate. Full split results and actual latency are in [ai04-evaluation.md](ai04-evaluation.md).

## E. Eight known risk scenarios

[known-risk-regressions.json](evidence/ai04/known-risk-regressions.json) and the evaluation report identify all eight pairs, their individual checks and exact disposition.

The four incorrect counterparty suggestions, three train and one development, are UNRESOLVED_REVIEW with COUNTERPARTY_CONFLICT. Conflicting strings cannot establish identity; the verifier does not assert that spelling difference alone proves a financial mismatch.

The four economically genuine suggestions contradicting ABSTAIN_INSUFFICIENT, three train and one development, are UNRESOLVED_REVIEW with REFERENCE_MISSING. This is a generic requirement for positive independent reference and counterparty evidence. No authored abstention field or pair-specific condition enters runtime. E1's four analogous contradictions are also withheld.

These outcomes are regression observations on known train/development cases, not independent proof of generalization. The design was informed by the disclosed AI03 risk categories. There are no hardcoded pair IDs, labels, family rules or model changes in the verifier.

## F. Performance and deterministic replay

Seven in-process verification runs per method/split produced exactly one output fingerprint in each of six batches. The output binds source projection, ordered proposal input, policy, versions and decisions with SHA-256 canonical JSON. No timestamp enters a fingerprint. Reversing records does not choose a new partner, although the bound ordered input representation has a different input fingerprint.

Actual p50/p95 and all 42 timing samples are in results.json and the evaluation report. Intervals include full scope validation, financial recomputation, alternatives, conflicts and fingerprints, and exclude file loading, projection construction, labels and model inference. Complexity is O(N² + P×N + P²), plus bounded decimal/serialization work. Seven samples do not establish a production tail estimate. No inference/API charge, GPU, database query or network call is incurred by AI04 verification; monetary processing cost was not measured.

The existing pinned model remains Xenova/multilingual-e5-small at revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, CPU FP32, 384 dimensions, Transformers 4.3.2. Runtime, weights and caches stayed outside Git and were neither downloaded nor reinstalled. No real inference rerun was needed.

## G. Regression and preservation evidence

The starting-file SHA-256 snapshot was written outside the repository before implementation. checks.json records the number of pre-existing files byte-verified unchanged and the snapshot hash. This includes AI01–AI03, DB01–DB03 source/docs/results, migrations, existing tests and the DB03 demonstration changes. AI01 M1/M2 manifests were separately verified, together with AI02's 50 and AI03's 79 source/reference/artifact hashes. Frozen fixture tests passed without writing snapshots.

The ZIP excludes raw financial input records, annotation sidecars, model weights, runtime dependencies, caches, secrets and PostgreSQL artifacts. It contains only AI04 implementation/tests/docs, sanitized measured decision evidence and unchanged relevant interfaces. Input/truth and original result hashes are recorded as externalInputs in the integrity manifest. This review package overlays the existing repository; reproducing dataset evaluation requires its hash-matched existing fixtures.

## H. Actual commands and tests

| Verification | Final executed result |
| --- | --- |
| AI04 focused | 48 passed, 0 failed, 0 skipped; two files |
| Combined suite | 860 passed, 0 failed, 1 intentionally skipped; 37 passing files and one skipped file |
| AI01 / AI02 / AI03 unit within combined | 213 / 48 / 27 passed |
| Existing API/persistence/grouped within combined | 514 passed, including 25 native PostgreSQL tests |
| DB03 safety/history within combined | 10 passed |
| Native environment | PostgreSQL 18.6, newly initialized disposable loopback cluster; existing migration compatibility/concurrency cases passed |
| TypeScript | next typegen and tsc --noEmit --incremental false passed |
| Strict targeted ESLint | Passed, zero warnings/errors |
| Whitespace and artifact verification | Git tracked/staged checks passed; new-file/source/evidence and ZIP hashes verified during packaging |

Counts overlap: the combined count includes the 48 focused AI04 tests and all listed regression components. The prior AI03 total 813 included its real-model test. The current 861-test inventory includes 48 additional AI04 tests; 860 passed and the real-model evidence-writing test was intentionally skipped. It is not counted as a current pass. Preserved AI03 actual-inference evidence supplies the recorded E5 proposals. No native PostgreSQL test was skipped or claimed from a mock. No full DB01 benchmark or DB03 recovery drill was rerun.

From the repository root, PowerShell:

```powershell
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
$env:AI03_REAL = '0'
$env:AI02_WRITE_EVIDENCE = '0'
$env:AI04_WRITE_EVIDENCE = '1'
pnpm exec vitest run tests/reconciliation/ai04.test.ts tests/reconciliation/ai04-evaluation.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai04/focused-tests.json
$env:AI04_WRITE_EVIDENCE = '0'
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai04/regressions.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai04 tests/reconciliation/ai04*.ts --max-warnings=0
git diff --check
git diff --cached --check
node research/reconciliation/ai02/verify.mjs
node research/reconciliation/ai03/verify.mjs
node research/reconciliation/ai04/verify.mjs
```

The approved disposable native harness needed loopback permission through the normal tool approval mechanism. DB03's test configuration disables environment-file loading. Initial focused tests had two assertion failures because the positive unit fixture also contained a financially plausible competitor; the unit-only source money was made unique while preserving frozen data and conservative runtime behavior. That 44-pass/2-fail report remains in initial-tests.json. An initial typecheck rejected an intentional invalid-policy test cast; an explicit unknown boundary corrected the test. Final checks passed. A tool action was briefly blocked by an automatic approval usage limit and was not executed; continuation resumed safely without bypassing review.

Adversarial coverage includes exact mismatch/large precision, currency/direction/date, posting basis, missing/wrong source identity and role, self/missing record, counterparty/reference absence/conflict, duplicate identities/proposals, reused assignments, recurring alternatives, unsupported group/partial topology, incomplete provenance/eligibility, malformed decimal/null/zero, source basis/null columns, injected scores/support/truth, missing/altered policy, held-out denial, shortlist incompleteness, immutable projection, deterministic replay, sparse truth and contradictory evaluation labels.

## I. Remaining requirements and risks

| Decision / risk | Current boundary and required follow-up |
| --- | --- |
| Client financial/date conventions | Synthetic basis and two-day policy only. SAIC must approve account-specific direction, monetary and date semantics before operational use. |
| Producer V2 eligibility | No trusted production contract exists here. Integrating legacy VALID/WARNING is not authorized or equivalent. |
| Provenance and account scope | Local synthetic declaration checks are available. Document authenticity, trusted account linkage, reconciliation eligibility and authorization remain unverified in production. |
| Entity/reference authority | Exact strings are conservative research evidence, not entity resolution or authenticated transaction identifiers. Missing/renamed entities require approved evidence and review. |
| Coverage loss | A plausible alternative causes abstention even when a reference looks stronger. More nuanced resolution needs separately reviewed evidence/policy, not a semantic-score override. |
| Grouping/partial payments | Explicitly unsupported; remain unresolved without aggregation. |
| Malicious full-cohort fabrication | Structural completeness cannot authenticate forged source data. A trusted producer/provenance boundary is required. |
| Approval authority | VERIFIED_SUGGESTION remains a research suggestion. No posting, accounting approval, RBAC or API workflow was implemented. |
| Evaluation generalization | Policy was developed with disclosed train/development risks. Held-out comparative evaluation is still required after policy freeze/review. |

## J. Readiness and review package

AI04 is ready for independent review and consideration of a frozen policy for AI05. Reviewers should assess the 18% coverage tradeoff and unresolved production contracts before authorizing final held-out comparative evaluation. AI05, AI06 and AI07 were not started.

The review ZIP and SHA-256 sidecar are created outside the repository. Its internal integrity manifest uses CRLF-to-LF normalization for text source files and byte-exact hashes for artifacts and external evaluation inputs. The ZIP itself has an external SHA-256 sidecar to avoid a self-referential checksum. Every archive entry is compared byte-for-byte with its workspace source. No GitHub publication occurred.

The complete new-file inventory and purposes follow below; checks.json also provides machine-readable new/reference/package lists.

| New repository-relative file | Purpose |
| --- | --- |
| docs/reconciliation/ai04-evaluation.md | Actual before/after metrics, eight risk cases, latency and limitations. |
| docs/reconciliation/ai04-integrity-manifest.json | Portable SHA-256 source, byte-exact artifact and external-input manifest. |
| docs/reconciliation/ai04-verification.md | Complete engineering report and new-file inventory. |
| docs/reconciliation/evidence/ai04/additional-genuine-matches.json | Two real E5 additions over E1 and their withheld dispositions. |
| docs/reconciliation/evidence/ai04/checks.json | Preservation, versions, checks, counts and exact package inventories. |
| docs/reconciliation/evidence/ai04/focused-tests.json | Final 48-pass AI04 Vitest report. |
| docs/reconciliation/evidence/ai04/initial-tests.json | Preserved initial 44-pass/two-fail development evidence. |
| docs/reconciliation/evidence/ai04/known-risk-regressions.json | All eight known E5 risk dispositions and reasons. |
| docs/reconciliation/evidence/ai04/regressions.json | Final combined 860-pass/one-skipped Vitest report. |
| docs/reconciliation/evidence/ai04/results.json | Measured six-batch replay, individual decisions, metrics, timing samples and fingerprints. |
| research/reconciliation/ai04/README.md | Design, policy, boundary, error semantics and Windows reproduction instructions. |
| research/reconciliation/ai04/evaluation.ts | Separate label-only economic/operational evaluator; sparse-label handling. |
| research/reconciliation/ai04/experiment.ts | Read-only recorded-proposal replay and measured deterministic training/development evaluation. |
| research/reconciliation/ai04/financial-verifier.ts | Independent exact financial, monetary-basis, date and source checks. |
| research/reconciliation/ai04/identity-verifier.ts | Conservative reference/counterparty evidence checks. |
| research/reconciliation/ai04/orchestrator.ts | Scope, financial, competition and assignment verification with deterministic fingerprints. |
| research/reconciliation/ai04/policy.ts | Frozen explicit policy and strict configuration validation. |
| research/reconciliation/ai04/projection.ts | Source-only immutable projection and forbidden-field boundary. |
| research/reconciliation/ai04/types.ts | Versioned research projection, proposal, policy, check and disposition contracts. |
| research/reconciliation/ai04/verify.mjs | Read-only source/artifact/external-input integrity verifier. |
| tests/reconciliation/ai04-evaluation.test.ts | Three evaluator, sparse-label, contradiction and eight-risk replay tests. |
| tests/reconciliation/ai04.test.ts | 45 deterministic adversarial/runtime tests. |
