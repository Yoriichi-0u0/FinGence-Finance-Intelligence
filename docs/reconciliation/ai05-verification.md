# AI05 final reconciliation evaluation — engineering report

30 October 2026, Asia/Singapore. **AI05 is complete for independent engineering review.** One frozen official held-out experiment executed real offline pretrained E5 inference, sealed predictions before labels and completed a separate evaluator stage. No official retry, post-result configuration change or retuning occurred.

## A. Repository and starting state

Repository: Yoriichi-0u0/FinGence-Finance-Intelligence. Checkout: `C:\Users\celes\Downloads\COS40005 FYP\FinGence-Finance-Intelligence`.

Branch remains `feature/backend-celester`, upstream `origin/feature/backend-api-celester`, HEAD `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca`. The existing `scripts/db03/run.mjs` modification, three DB03 demonstration evidence directories and untracked reconciliation research/docs/tests remain. Nothing was staged, committed, pushed, switched, reset, merged or deployed. Draft PR #2 was not accessed or changed.

AGENTS.md, AI01–AI04 source/contracts/docs, real historical training/development outputs, frozen configurations, model metadata and cached files, the approved held-out interface and native testing infrastructure were inspected. The user-provided AI04 approval and existing AI04 report supplied the review findings; no additional independent review file was found. Source preservation was snapshotted before implementation outside the repository.

## B. Compatibility finding and implementation

Preflight demonstrated that E0/E1 shared validation, E5 ranking and AI04 projection/verifier reject heldout. That was a real integration boundary, not permission to relabel inputs or remove checks. The initial blocked preflight remains as evidence. The user then explicitly approved a minimal, separately versioned compatibility adapter while preserving rules, thresholds, historical results, data boundaries and the one-off official protocol.

AI05 implements `ai05-heldout-adapter/1.0.0` entirely in new files. **No AI01–AI04 file changed.** It uses AI01 heldoutCandidates/developmentCandidates, AI02 blockedReason/epochDay/exactScore/fuzzyScore/resolve, AI03 semanticText/cosine/Embeddings/LocalE5Provider and AI04 sourceChecks/financialChecks/identityChecks/POLICY. Entry-point orchestration is necessary because the existing public entry points deny heldout. Actual split identities remain heldout; static TypeScript bridges only satisfy older resolver/source-check annotations whose runtime primitives already work with declared held-out templates/periods.

The adapter duplicates only required composition logic: complete candidate loops, unchanged scoring/rank/fingerprint construction and AI04 scope/competition/assignment/disposition orchestration. It adds no score, financial tolerance, grouping, case-specific exception or verification relaxation. A WeakSet admits only projections produced by the approved AI01 interface. Source evidence is deeply frozen. Proposal fields remain IDs, algorithm and topology; injected score/truth fields are rejected.

Before official execution, parity tests reproduced all four saved E0/E1 training/development fingerprints, E5 fingerprints using identical deterministic injected vectors and exact original AI04 decisions/fingerprints for every recorded training/development algorithm batch. Mock vectors were used only for parity tests. Actual pretrained inference supplies the official predictions.

## C. Frozen protocol and integrity

The [evaluation protocol](ai05-evaluation-protocol.md) was written and byte-frozen before the official attempt. freeze.json captures the actual reviewed baseline/model/verification settings, metrics/software source hashes, dependency locks, official test driver, protocol, input/dataset hashes, six model hashes, runtime versions, hardware and measurement rules.

| Frozen setting | Value |
| --- | --- |
| Dataset | ai01-m2/1.1.0, original artifact manifest unchanged |
| E0 | Threshold 1, margin 0; unchanged exact-reference policy |
| E1 | Threshold .95, margin .20; unchanged fixed fuzzy weights/contradiction guard |
| E2b | Threshold .90, margin .03; unchanged AI03 text/cosine/rank/assignment |
| Shared blocking | Exact decimal amount, currency, explicit direction, canonical-date gap ≤2 days |
| Verification | ai04-policy/1.0.0; complete cohort, exact reference/counterparty, conservative competition, unique assignment, PAIR only |
| Model/tokenizer revision | 761b726dd34fb83930e26aab4e9ac3899aa1fa78 |
| Numerical repeat tolerance | 1e-5; score/tie rounding remains 1e-6 |
| Measurement | First observation plus seven fixed warm replays, no selection/tuning |

Freeze fingerprint: `0874f932eca2a38e83730c872eda6cde57d9a73d57ad59bcace41b1b11dd80b2`.

Evaluation fingerprint: `5316a91b047695ed381b7337b50a4a21b590df3eca8d284219b57a28e9e0f170`.

Byte hashes binding freeze.json to predictions.json are in prediction-seal.json; every source/artifact hash remains available in freeze.json and the final package manifest. Fingerprints exclude timing fields where the original algorithms require that; measured timing samples remain separate evidence. Configuration software/current artifact integrity was revalidated before prediction sealing, before truth loading and during final checks.

## D. Label isolation and official execution

The prediction process saved freeze.json before loading the held-out source. It executed all three algorithms and independent verification, retained the first predictions, checked fixed warm replay fingerprints and made one direct uncached numerical comparison. It saved complete candidates/proposals/verification checks and prediction-seal.json, then closed the model worker. No annotation JSON was parsed by the prediction stage.

In a separate process, the evaluator validated frozen bytes/current software before loading truth from the original `research/reconciliation/m2/fixtures/evaluation-only/heldout-truth.json`. It called AI01 heldoutAnnotations, including complete-benchmark integrity validation using existing training/development sidecars. No truth is copied into ranking features, proposals or verification evidence. No matcher or model is called after labels load in the official evaluator.

The prediction directory and write-once files prevent automatic re-execution/overwrite. Both official stages succeeded on their first attempt; no failure artifact or retry exists. Fixed warm replays are part of the predeclared single experiment for latency/reproducibility, not repeated evaluation or tuning. Later full regressions keep both official stages disabled. The independent read-only audit inspects sealed output and labels after the completed experiment; it neither reruns inference nor changes results.

This is a software/process boundary in a research checkout, not an OS-enforced confidential-data sandbox. Reviewers must preserve that distinction.

## E. Actual population and eligibility

The original held-out interface validated 100 synthetic records, 50 BANK and 50 LEDGER, across four unseen schemas: wallet bank, minimal cashbook, treasury bank and localized expense ledger. Eligibility, source identity/lineage, date/monetary bases and exact source values passed the existing source contract. The independently validated truth contains **32 genuine PAIR relationships, 28 explicit negative edges, four GROUP/PARTIAL relationships, 24 unmatched records and eight authored ambiguity cases**. These are actual counts, not assumed research-plan totals.

All methods share 232 financial/date-eligible candidate pairs and preserve all 32 genuine pairs: blocking recall 32/32. Unsupported grouped relationships are excluded from pair recall. Sparse unannotated edges are never treated as confirmed negatives.

## F. Before-and-after matching results

| Method / stage | TP | Explicit FP | FN | Precision | Recall | F1 | Bank coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 before | 14 | 0 | 18 | 100% | 43.75% | 60.87% | 14/50 (28%) |
| E1 before | 16 | 0 | 16 | 100% | 50% | 66.67% | 16/50 (32%) |
| E2b before | 18 | 2 | 14 | 90% | 56.25% | 69.23% | 20/50 (40%) |
| E0 after | 8 | 0 | 24 | 100% | 25% | 40% | 8/50 (16%) |
| E1 after | 8 | 0 | 24 | 100% | 25% | 40% | 8/50 (16%) |
| E2b after | 8 | 0 | 24 | 100% | 25% | 40% | 8/50 (16%) |

All three verified pair sets are identical. Each leaves 42/50 bank records unresolved (84%). Unresolved records are not counted as reconciled. All actual suggestions are annotated; unannotated count is zero. Precision is assessed TP/(TP+explicit FP), not an assumption that arbitrary candidate edges are negative. Undefined metrics remain null in tests/evaluator.

Recall@1 is 16/32 for E0 and 20/32 for E1/E2b. Recall@3 and @5 are 22/32 for all methods. The pessimistic worst equal-score bank rank is unchanged. Full metrics, raw samples and per-check outcomes are in [ai05-results.md](ai05-results.md) and sealed evidence.

## G. Verification impact and operational safety

AI04 retains eight correct proposals per method. It withholds six correct E0 proposals, eight correct E1 proposals and ten correct E5 proposals, plus both explicit false E5 proposals. The unresolved-review proposal counts are respectively 6, 8 and 12; blocked proposal counts are zero. The upstream financial pool already excludes definitive financial violations, so unsafe identity cases remain unresolved rather than being mislabeled definitive accounting falsehoods.

E5's two incorrect counterparty suggestions consume four unmatched records. E1 and E5 each produce two economically correct suggestions contradicting authored abstention. Verification withholds all of those risks. E5 also adds two genuine pairs beyond E1, but both are withheld for missing reference/competing financially plausible partners. Semantic similarity cannot supply absent independent identity evidence.

Raw missing-identity proposal counts are E0=2, E1=4 and E5=6. E5 also has two counterparty conflicts, giving eight proposals with unverified source/financial/identity evidence under that metric. Additional conservative competition cases explain the full unresolved counts. After verification, all methods have zero observed amount/currency/direction/date violations, counterparty conflicts, missing/unknown evidence surfaced, duplicate assignments, unsupported grouped associations, unmatched records suggested, forced ambiguity or authored-abstention contradictions.

These are separate operational metrics, not equivalent to economic precision or proof of production safety. Complete individual PASS/FAIL/NOT_VERIFIED evidence and reason codes remain in predictions.json. Reason frequencies can overlap and must not be added as if they were disjoint proposal populations.

## H. Measured performance and environment

| Method | First pipeline | Warm pipeline p50 | Warm pipeline p95 | Warm samples |
| --- | ---: | ---: | ---: | ---: |
| E0 | 30.707 ms | 20.913 ms | 22.409 ms | 7 |
| E1 | 32.702 ms | 27.674 ms | 38.885 ms | 7 |
| E2b | 4049.105 ms | 24.068 ms | 57.810 ms | 7 |

E5 initialization/integrity/loading took 3609.514 ms, inside 4012.658 ms embedding wall time. Its first ranking/fingerprint interval took 14.821 ms and AI04 verification 17.878 ms. First E0/E1 candidate construction took 5.380/4.044 ms and ranking/fingerprint 7.796/13.470 ms; their first verification took 17.297/15.167 ms. Component intervals nest, so initialization must not be added again to embedding time. File input/projection, freeze validation, label evaluation and artifact writes are outside per-method pipeline timing.

The first E5 pipeline cost about 4.016 seconds more than first E1 in this observation. There is only one first/cold observation, so no cold p50/p95 is claimed. Model hashing had warmed OS file cache; a new worker is not cold disk. Warm E5 replays use cached embeddings and therefore cannot be presented as cold-inference speed comparisons. Seven-sample p95 is the maximum observation, not a reliable production tail estimate.

The model computed 28 unique text embeddings in four service batches, with 199 unique-text cache hits across requests, zero evictions and zero truncations. Service inference/IPC time was 401.571 ms. One additional direct real-model call checked three samples; five actual forward calls occurred in total. Maximum cached-versus-uncached vector delta was approximately 2.6382e-8, below 1e-5. Each algorithm's first run plus seven replays produced one stable ranking and one verification fingerprint.

Sampled worker RSS reached 906,530,816 bytes after service batches. This is neither continuous nor total-system peak memory. The existing 2 GiB JavaScript heap cap does not bound all native ONNX memory. Environment/hardware are recorded verbatim in freeze.json: Windows x64, Node v24.14.1, Transformers 4.3.2, Intel Core Ultra 5 125H. CPU FP32, one intra-op/inter-op thread, sequential execution, 384-dimensional attention-mask mean pooling/L2 and 512-token maximum remain unchanged.

All six pre-existing model files, 492,421,582 bytes total, matched pinned SHA-256. No weight/runtime installation, download or external inference occurred. Current model metadata and local resource limitations are in the results report; prior runtime disk evidence is referenced rather than invented anew.

## I. Independent integrity and preservation

A separate post-seal audit imports no official adapter or metric implementation. It independently reconstructs exact financial candidate eligibility, all three ranking fingerprints, worst-tie ranks, TP/explicit-FP/FN counts, unique verified assignments, reference/counterparty sufficiency and competing-partner checks. It confirms 232 shared candidates, 32 surviving genuine pairs, the same eight verified edges and two additional genuine E5-over-E1 pairs withheld by verification.

Final preservation compares all **1,055 pre-existing files** against the starting SHA-256 snapshot. AI01 M1/M2 source/artifact manifests and AI02/AI03/AI04 verifiers pass unchanged, including all historical training/development measurements. The model remains external and hash-identical. No migration, DB01 benchmark, DB03 recovery drill, API, ingestion, security, frontend or teammate source was changed.

## J. Actual testing and commands

| Check | Actual result |
| --- | --- |
| Pre-official AI05 tests | 21 passed, zero failed/skipped, three files |
| Official prediction stage | One passed, one evaluator-stage test intentionally skipped; actual PRETRAINED_E5 inference |
| Separate official evaluation stage | One passed, one prediction-stage test intentionally skipped |
| Final combined suite | 881 passed, zero failed, three intentional skips; 40 passing files and two skipped files |
| Existing native PostgreSQL | 25 passed within combined suite, disposable PostgreSQL 18.6 |
| TypeScript | next typegen and tsc --noEmit --incremental false passed before official freeze |
| Targeted strict lint | Source/tests and independent audit passed with zero warnings/errors |
| Integrity/whitespace | Frozen sources/config/model, prediction seals, independent audit, historical manifests and Git whitespace checks passed |

The combined 881 includes 860 existing AI01–AI04/API/persistence/DB03 tests and the 21 ordinary AI05 tests. It deliberately skips both one-shot official stages and the historical AI03 evidence-writing model test. Both AI05 official stage tests passed separately, giving 23 AI05 tests exercised successfully and 883 distinct tests passed across the current verification runs; do not add overlapping suite totals. The one historical AI03 model test was not rerun, but actual AI05 model inference executed. No native PostgreSQL test was unavailable or skipped.

PowerShell commands, repository root (TEMP/TMP pointed to the existing writable ../ai01-m2-temp):

```powershell
pnpm exec vitest run tests/reconciliation/ai05-preflight.test.ts tests/reconciliation/ai05-adapter.test.ts tests/reconciliation/ai05-metrics.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/pre-official-tests.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai05 tests/reconciliation/ai05*.ts --max-warnings=0
# Exactly once for each official stage:
$env:AI05_STAGE = 'predictions'
pnpm exec vitest run tests/reconciliation/ai05-official.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/prediction-tests.json
node research/reconciliation/ai05/verify.mjs --model
$env:AI05_STAGE = 'evaluation'
pnpm exec vitest run tests/reconciliation/ai05-official.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/evaluation-tests.json
$env:AI05_STAGE = ''
$env:AI03_REAL = '0'
$env:AI02_WRITE_EVIDENCE = '0'
$env:AI04_WRITE_EVIDENCE = '0'
$env:AI05_WRITE_PREFLIGHT = '0'
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/regressions.json
node docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs
node node_modules/eslint/bin/eslint.js research/reconciliation/ai05 tests/reconciliation/ai05*.ts docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs --max-warnings=0
node research/reconciliation/ai02/verify.mjs
node research/reconciliation/ai03/verify.mjs
node research/reconciliation/ai04/verify.mjs
node research/reconciliation/ai05/verify.mjs --model
git diff --check
git diff --cached --check
```

The existing native harness ran with the normal tool approval for disposable loopback connections. No existing or hosted database was used. Its configuration disables environment-file loading. No implementation test failure occurred; the initial runtime capability rejection is intentionally recorded as a preflight blocker, resolved only after user authorization. Machine-readable reports retain stage-specific skips and timing evidence honestly.

## K. Research conclusion and statistical scope

E5 found four more genuine pairs than E0 and two more than E1 before verification, while introducing two explicit false suggestions and two authored-abstention contradictions. AI04 withheld both explicit false suggestions but also ten genuine E5 pairs, including its two additional-over-E1 matches. The final E5 pipeline therefore improves neither verified recall nor coverage over the traditional methods. Its raw synthetic F1 improvement is not evidence of a final verified or production advantage.

The measurements support a semantic raw-retrieval benefit coupled with identity risk and a conservative precision/coverage tradeoff. They do not establish statistical significance, client document accuracy, an aspirational accuracy target, safe automatic confirmation or general production resource requirements. No confidence interval or significance test is claimed. The 100 records are authored, related scenarios across four schemas, not independent random production trials.

## L. AI06 readiness and unresolved dependencies

AI05 is ready for independent review. Reviewers can use the frozen evidence to decide the value of semantic ranking under the current verification policy. AI06 persistence/API design still needs approved producer V2 eligibility and source-revision contracts, authenticated provenance/account linkage, account-specific monetary/date conventions, counterparty/reference authority, grouping/partial-payment handling, approval authority, lifecycle/audit/idempotency and security ownership. The [limitations register](ai05-limitations.md) records these boundaries.

AI06, AI07 and DB04 were not started. No new database migration, HTTP endpoint, model retuning or financial write was introduced. Production remains unchanged.

## M. Review package and new-file inventory

The local independent-review ZIP contains all new AI05 implementation/tests, frozen experiment/protocol, complete candidates/proposals and AI04 decisions, metrics, latency/model metadata, independent audit, relevant unchanged AI01–AI04 interfaces, machine-readable test reports and integrity manifest. It excludes raw source fixtures, copied held-out truth, weights, dependencies/caches, secrets, real financial documents and PostgreSQL artifacts. This is an overlay for the existing hash-matched repository.

Source/package hashes use documented CRLF-to-LF text normalization; raw evidence/artifacts remain byte-exact. Historical manifests were not changed. ZIP SHA-256 is an external sidecar to avoid self-reference. Every archive entry is compared with workspace bytes. The machine-readable checks and the following table list every new file and purpose.

Supplementary installed-runtime inventory confirms ONNX Runtime Node 1.30.0 and Transformers 4.3.2. The external package-lock SHA-256 is 2e69fc01810d1d4a329e6387de8cd41061d8138709c5a4b05c5caa0550baaa84, byte-identical to the approved AI03 lock copy captured in the pre-truth starting snapshot. This post-execution inventory is explicitly supplementary and was not retroactively inserted into the official freeze. See runtime-versions.json.

| New repository-relative file | Purpose |
| --- | --- |
| docs/reconciliation/ai05-evaluation-protocol.md | Pre-label frozen protocol, configurations, metrics, timing and boundary rules. |
| docs/reconciliation/ai05-integrity-manifest.json | Portable source and byte-exact artifact/package SHA-256 inventory. |
| docs/reconciliation/ai05-limitations.md | Research limitations, integration requirements and interpretation boundaries. |
| docs/reconciliation/ai05-results.md | Actual held-out before/after outcomes, safety, retrieval and measured resources. |
| docs/reconciliation/ai05-verification.md | Complete engineering report and inventory. |
| docs/reconciliation/evidence/ai05/adapter-tests.json | Initial 11 passing preflight/adapter tests. |
| docs/reconciliation/evidence/ai05/checks.json | Final preservation/test/safety summaries and exact package inventories. |
| docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs | Separate post-seal read-only evaluator diagnostic, never a runtime dependency. |
| docs/reconciliation/evidence/ai05/evaluation-tests.json | Separate official evaluation stage report. |
| docs/reconciliation/evidence/ai05/independent-audit.json | Independent candidate/ranking/finance/identity/metric validation evidence. |
| docs/reconciliation/evidence/ai05/model-integrity.json | Read-only six-file pinned model/runtime verification before official execution. |
| docs/reconciliation/evidence/ai05/official/evaluation.json | Single official held-out metrics and fingerprint. |
| docs/reconciliation/evidence/ai05/official/freeze.json | Official pre-label configuration/source/software/model seal. |
| docs/reconciliation/evidence/ai05/official/prediction-seal.json | Byte-exact link between frozen configurations and predictions before labels. |
| docs/reconciliation/evidence/ai05/official/predictions.json | Complete frozen candidates/proposals, checks, first/warm timings and numerical evidence. |
| docs/reconciliation/evidence/ai05/pre-official-tests.json | Final 21-test pre-label verification report. |
| docs/reconciliation/evidence/ai05/prediction-tests.json | Actual pretrained official prediction stage report. |
| docs/reconciliation/evidence/ai05/preflight-tests.json | Initial three-test preflight report. |
| docs/reconciliation/evidence/ai05/preflight.json | Preserved initial blocker/preparation evidence; not the official freeze. |
| docs/reconciliation/evidence/ai05/regressions.json | 881-pass/three-intentional-skip combined report. |
| docs/reconciliation/evidence/ai05/runtime-versions.json | Supplementary actual external runtime/approved-lock parity inventory. |
| research/reconciliation/ai05/README.md | Module map, boundaries and verification commands. |
| research/reconciliation/ai05/adapter.ts | Authorized source-only compatibility composition; existing financial/scoring/verification rules reused. |
| research/reconciliation/ai05/freeze.ts | Reviewed configuration/software/model integrity seal before official predictions. |
| research/reconciliation/ai05/heldout-evaluator.ts | Separate exclusive official evaluation-only label loader. |
| research/reconciliation/ai05/metrics.ts | Frozen pure economic, retrieval, verification-impact and operational definitions. |
| research/reconciliation/ai05/prediction-runner.ts | One-shot offline predictions, fixed replays and pre-truth seal. |
| research/reconciliation/ai05/preflight.ts | Initial old-entry-point capability checks and preparatory configuration snapshot. |
| research/reconciliation/ai05/types.ts | Held-out-capable contracts and explicit adapter version. |
| research/reconciliation/ai05/verify.mjs | Read-only frozen-source/model/seal/replay/package integrity checks. |
| tests/reconciliation/ai05-adapter.test.ts | Eight compatibility, historical parity, injected truth and model-failure tests. |
| tests/reconciliation/ai05-metrics.test.ts | Ten frozen configuration, metric, safety, label and artifact-boundary tests. |
| tests/reconciliation/ai05-official.test.ts | Two explicitly staged one-shot official prediction/evaluation tests. |
| tests/reconciliation/ai05-preflight.test.ts | Three preflight/configuration/guard tests. |
