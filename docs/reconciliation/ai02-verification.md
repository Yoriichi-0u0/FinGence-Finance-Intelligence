# AI02 engineering verification report

30 October 2026, Asia/Singapore. **AI02 is implemented locally and ready for independent research/engineering review**, with the operational limitations below. No production approval or financial correctness guarantee follows from a baseline score.

## Repository state and preserved work

Starting and ending branch: feature/backend-celester. Upstream: origin/feature/backend-api-celester. HEAD: 9385da7f4bb5ef9abbf2dec39b31e60e639fcaca. The starting tree already contained the modified scripts/db03/run.mjs, three untracked DB03 demonstration evidence directories and untracked AI01 research/docs/tests. Nothing was switched, staged, reset, committed or pushed. The only tracked diff remains the pre-existing DB03 runner change.

AGENTS.md, M1/M2 specifications, annotation/split protocols, research contracts, exact-decimal helpers, validation/access boundaries, existing tests, package scripts and TypeScript/Vitest configuration were inspected. The approved dataset version and M1/M2 integrity manifests were verified before implementation. All pre-existing research, reconciliation tests/docs, scripts, database documentation and SQL files were byte-fingerprinted before editing and are verified unchanged. No held-out AI02 matching or threshold evaluation took place; required existing AI01 integrity tests still inspect their frozen fixtures without being used for tuning.

## Implementation and findings

Ten small TypeScript modules implement strict projected-input contracts, a separate approved-input adapter, shared exact financial/date blocking, E0 raw-reference support, E1 Unicode token/bigram scoring, mutual unique assignment, deterministic run fingerprints, separate evaluation and a development-only parameter experiment. No third-party dependency, model, API, database integration or production configuration was introduced. The exact candidate and scoring policies are in [ai02-baseline-spec.md](ai02-baseline-spec.md).

Both methods preserve all 48 training and 16 development genuine pairs through blocking. The pool includes 498 training and 66 development edges. Twelve train/development description-dependent true pairs remain eligible; the reserved six held-out pairs were not executed. E0 suggests 21/7 genuine pairs, E1 24/8. No explicit false, unannotated, unmatched-record or group-associated suggestions occurred in these runs. The complete retrieval, matching, operational and measured latency tables are in [ai02-evaluation.md](ai02-evaluation.md).

**Material limitation:** E1's additional three training and one development true suggestions conflict with authored ABSTAIN_INSUFFICIENT operational outcomes. Its economic recall improvement is therefore not evidence of safer reconciliation. Neither baseline suggests any of the twelve evaluated description-dependent pairs at the selected policy. Results were not tuned or labels rewritten to conceal this. All authored recurring/duplicate ambiguity cases abstain, all actual suggestions have unique source consumption, and invalid financial candidate count is zero.

The fixed nine-point development grid produced identical matching counts; its predetermined tie-break selected .95 threshold and .20 margin. Weights, grid and selection rule were established before computing development results. Canonical dates use an explicit experimental two-day window. No held-out result influenced these choices. Training/development metrics are not unbiased final evaluation estimates.

## Exact tests and commands executed

| Check | Actual result |
| --- | --- |
| Focused AI02 tests | 48 passed, 0 failed/skipped, five files |
| Combined reconciliation/API/persistence/grouped/DB03 safety suite | 785 passed, 0 failed/skipped, 34 files |
| Existing AI01 tests within combined run | 213 passed unchanged |
| Existing native PostgreSQL tests within combined run | 25 passed on PostgreSQL 18.6 |
| TypeScript | Passed full Next route type generation and tsc, no incremental cache |
| Targeted ESLint | Passed with zero warnings/errors |
| Git and new-file whitespace | Passed |
| M1 and M2 manifests and starting-file hashes | Passed unchanged |
| AI02 source/evidence/reference manifest and ZIP byte comparison | Verified during final packaging |

The combined count includes the focused tests and AI01 tests; counts must not be added together. It also includes the 514 existing persistence/API/grouped regressions and ten DB03 safety/history tests. No full DB01 benchmark or DB03 recovery drill was regenerated. The native harness uses newly created disposable clusters and synthetic data; no existing developer database, hosted Supabase, production environment file or credentials were accessed.

Commands run from the repository root (PowerShell):

```powershell
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
$env:AI02_WRITE_EVIDENCE = '1'
pnpm exec vitest run tests/reconciliation/ai02-candidates.test.ts tests/reconciliation/ai02-exact.test.ts tests/reconciliation/ai02-fuzzy.test.ts tests/reconciliation/ai02-abstention.test.ts tests/reconciliation/ai02-evaluation.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai02/focused-tests.json
# In a separate process without AI02_WRITE_EVIDENCE:
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai02/regressions.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai02 tests/reconciliation/ai02-*.ts --max-warnings=0
git diff --check
git diff --cached --check
node research/reconciliation/ai02/verify.mjs
```

The existing sandbox blocks some local sockets, so the full unchanged regression harness ran through the normal approval mechanism for disposable loopback access. The writable temp path avoids the previously observed Vitest cache rename restriction. No unrelated code/test was changed to work around the environment. The initial focused implementation run passed 46 tests; two safety tests were subsequently added. An initial TypeScript check found an inferred string where Outcome.state required a literal union; an explicit map return type fixed it, followed by a successful full check. Initial failed checks are not counted as final passes.

Coverage includes exact and formatted references; missing references/optional fields; translated/abbreviated lexical evidence; financial mismatches; selected-date/null handling; large exact decimal precision; duplicate identity rejection; recurring/tied/near-tied candidates; mutual assignment conflicts; unmatched and unsupported grouped records; input permutation and no mutation; strict input field injection; sparse-label/undefined metrics; pessimistic tie ranks; denied held-out execution; and development-only tuning. Tests assert behavior, not a desired model winner.

## Every new file and purpose

| Repository-relative path | Purpose |
| --- | --- |
| research/reconciliation/ai02/types.ts | Independent projected-input, configuration and result contracts |
| research/reconciliation/ai02/adapter.ts | Approved AI01 development input validation/projection |
| research/reconciliation/ai02/candidates.ts | Shared exact financial/date blocking and strict validation |
| research/reconciliation/ai02/scoring.ts | Unicode normalization, token/bigram Dice primitives |
| research/reconciliation/ai02/exact.ts | E0 exact-reference support and explanation |
| research/reconciliation/ai02/fuzzy.ts | E1 lexical scoring and explanation |
| research/reconciliation/ai02/abstention.ts | Mutual unique support, tie/margin/conflict abstention |
| research/reconciliation/ai02/run.ts | Deterministic rankings, output orchestration and fingerprint |
| research/reconciliation/ai02/evaluator.ts | Economic, sparse-negative, operational and timing metrics |
| research/reconciliation/ai02/experiment.ts | Predeclared development grid and repeated timed replay |
| research/reconciliation/ai02/verify.mjs | Read-only manifest verifier |
| research/reconciliation/ai02/README.md | Usage, reproduction and module map |
| tests/reconciliation/ai02-fixtures.ts | Synthetic unit fixtures and train/development-only loader |
| tests/reconciliation/ai02-candidates.test.ts | Financial/eligibility/date/identity and pool coverage tests |
| tests/reconciliation/ai02-exact.test.ts | Exact-reference and missing/conflicting evidence tests |
| tests/reconciliation/ai02-fuzzy.test.ts | Unicode, formatting, lexical and missing-evidence tests |
| tests/reconciliation/ai02-abstention.test.ts | Ties, margin, conflict, grouping and reproducibility tests |
| tests/reconciliation/ai02-evaluation.test.ts | Metrics, isolation, configuration and evidence tests |
| docs/reconciliation/ai02-baseline-spec.md | Financial, scoring, assignment and future contract rules |
| docs/reconciliation/ai02-evaluation.md | Actual metrics, denominators, fingerprints and latency |
| docs/reconciliation/ai02-verification.md | This engineering report |
| docs/reconciliation/evidence/ai02/configuration.json | Frozen E0/E1 configuration and selection rule |
| docs/reconciliation/evidence/ai02/results.json | Full development grid, candidates, outcomes and results |
| docs/reconciliation/evidence/ai02/focused-tests.json | Machine-readable 48-test results |
| docs/reconciliation/evidence/ai02/regressions.json | Machine-readable 785-test results |
| docs/reconciliation/evidence/ai02/checks.json | Preservation, commands, inventory and package references |
| docs/reconciliation/ai02-integrity-manifest.json | Source/reference and artifact hashes |

No pre-existing source, documentation, fixture, migration, dependency or configuration file was modified. New files are confined to isolated AI02 paths under research/reconciliation, tests/reconciliation and docs/reconciliation.

## Review package and reproducibility

The review ZIP contains all new AI02 files, unchanged transitive AI01 interface dependencies, training/development inputs and separate annotations, relevant AI01 specifications, and unchanged package/TypeScript/test configuration references. It is an overlay review package for the existing project and installed dependencies, not a replacement application or dependency installer. The full native regression suite needs the existing repository. Held-out inputs/truth, AI01 generators, databases, raw backups/WAL, credentials, node_modules and caches are excluded. The complete exact ZIP inventory is in checks.json. Source hashes normalize CRLF to LF; artifacts remain byte-exact SHA-256. The archive is read back and every entry compared with the workspace. Original AI01 manifests and all historical artifacts stay unchanged.

## Remaining risks and AI03 readiness

Research date/alias/missing-reference rules require client review before operational use. Exact counterparty mismatch vetoes may reject real aliases; lexical similarity cannot translate concepts reliably. Shared synthetic grammar and values can create shortcuts. No model performance winner or production latency is established. The full pool, scoring and tie-ranking implementation is intentionally simple (Cartesian blocking and quadratic ranking) and is not optimized for production scale. Sparse unannotated edges stay distinct from confirmed negatives; metrics are conditional where necessary. The evaluator consumes trusted approved annotations, not arbitrary untrusted label uploads. Local APIs are not an adversarial security boundary.

The candidate feature contract, shared eligibility policy, assignment rules and evaluator are reusable for a later independently approved AI03 scorer. E5 Small must not receive IDs, source rows, family labels or annotations as input evidence, and the eventual final-test protocol must be frozen before held-out evaluation. No AI03, AI04, AI05, AI06, AI07, DB04, model inference or download was implemented. DB01–DB03, teammates' work, production and Draft PR #2 remain unchanged. No commit, push, merge, deployment or remote change occurred.
