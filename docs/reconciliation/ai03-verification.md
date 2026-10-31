# AI03 engineering verification report

30 October 2026, Asia/Singapore. **AI03 completed actual local pretrained inference and is ready for independent engineering/research review. It is not ready for production reconciliation approval.** E5's precision regressions and operational limitations are material findings, not failed engineering checks to conceal.

## Repository state, authorization and scope

Branch at start and finish: feature/backend-celester. Upstream: origin/feature/backend-api-celester. HEAD: 9385da7f4bb5ef9abbf2dec39b31e60e639fcaca. No branch switch, reset, staging, commit, push, merge, deployment or PR update occurred. The existing modified scripts/db03/run.mjs, three untracked DB03 demonstration evidence directories and all prior AI01/AI02 files were preserved. The only tracked diff is still that pre-existing DB03 runner change.

AGENTS.md, relevant handoff, frozen AI01 contracts, AI02 algorithms/metrics/tests, package/lock/TypeScript/Vitest configuration and likely local runtime/model caches were inspected. No compatible local inference runtime/model was found initially. Public npm/Hugging Face metadata was read to propose an exact runtime, revision, precision and disk estimate. The user explicitly approved @huggingface/transformers@4.3.2 and revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78 FP32 CPU, with runtime/weights outside Git and no root dependency edits. Installation and downloads occurred only after that approval.

All 826 fingerprinted pre-existing files, including root package.json, pnpm-lock.yaml, TypeScript configuration, AI01/AI02, database artifacts and migrations, remain byte-identical. AI01 M1/M2 and AI02 manifests pass. No application ingestion, persistence, API, security, frontend, analytics, production or teammate module was changed. No hosted Supabase, production environment/credential or real financial dataset was accessed.

## Actual runtime and model

- Original pretrained model: intfloat/multilingual-e5-small; authorized ONNX conversion: Xenova/multilingual-e5-small.
- Model and tokenizer revision: 761b726dd34fb83930e26aab4e9ac3899aa1fa78.
- Runtime: @huggingface/transformers 4.3.2; ONNX Runtime 1.30.0; FP32 CPU, sequential, one intra-op and one inter-op thread.
- Model has 384-dimensional output; pinned tokenizer limit is 512 tokens.
- Six model/tokenizer files total **492,421,582 downloaded bytes**. Every file was checked against pinned repository metadata (LFS SHA-256 or Git blob SHA-1), with SHA-256 recorded for all files. The loader rechecks all six SHA-256 hashes each fresh initialization.
- Runtime installed in ../ai03-runtime/; model in ../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78/. Neither is in Git or the review ZIP. The root dependency manifest and lockfile were not changed.
- npm installed 45 packages in its reported 28 seconds. Installed runtime disk is 495,646,502 bytes; model directory including download metadata is 492,424,168 bytes. npm's aggregate network-transfer bytes and additional shared npm cache size were not exposed/measured; these are not conflated with installed disk.
- [Runtime metadata](evidence/ai03/runtime.json), [download verification](evidence/ai03/download.json), and isolated [package](evidence/ai03/runtime-package.json)/[lock](evidence/ai03/runtime-lock.json) copies support reproduction.

The [ONNX publisher](https://huggingface.co/Xenova/multilingual-e5-small) identifies the converted base model. The [E5 model card](https://huggingface.co/intfloat/multilingual-e5-small) supports the symmetric query prefix and pooling/normalization design. The actual installed feature-extraction implementation was inspected: it uses the attention mask for mean pooling and the tokenizer's model_max_length for truncation. The worker validates that maximum is 512 instead of assuming an ignored call option enforces it.

## Architecture, embedding and assignment

AI03 is isolated under research/reconciliation/ai03/. The unchanged AI02 adapter validates approved development inputs; the unchanged financial candidate generator enforces exact money, currency, direction and the same two-day canonical date policy. Only description and optional counterparty are embedded, after NFKC/whitespace normalization and symmetric query prefixes. IDs, references, numbers/dates used for eligibility, roles, source metadata, splits and truth are not embedded. Ground truth reaches only a separate evaluator after ranking.

A dedicated Node child worker loads the model once, refuses remote model access and rejects fetch calls. Inference uses local files only. Input batches and caches are bounded; output dimensions, finite values and nonzero norms are validated. Timeouts/failures close the service and terminate the worker, without automatic retries. Successful shutdown disposes the extractor then terminates the child. The JS heap cap does not bound native ONNX memory; sampled RSS is reported separately.

Cosine is not a calibrated probability. Scores are rounded to six decimals for ties/fingerprints, with raw values retained as evidence. AI02's conservative mutual assignment and evaluator are reused through a structural adapter because their method types are frozen. The adapter never invokes E1 scoring or relabels public E2b reports. All financial candidates and evaluation denominators remain unchanged. No greedy ID-based tie-break, duplicate one-to-one consumption or group aggregation is introduced.

E1's exact counterparty veto is not imposed on semantic text. This deliberate scoring difference produced four explicit counterparty false suggestions, demonstrating why semantic similarity is not identity verification. It is not presented as equivalent to E1's support rule or as a production-safe policy.

## Comparison and safety findings

The [complete evaluation report](ai03-evaluation.md) includes split-level precision, recall, F1, recall@K, coverage, unresolved ratios, adverse outcomes and measured performance. Across the 64 genuine training/development pairs:

| Method | TP | Explicit FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| E0 | 28 | 0 | 36 | 100% | 43.75% | 60.87% |
| E1 | 32 | 0 | 32 | 100% | 50% | 66.67% |
| E2b | 34 | 4 | 30 | 89.47% | 53.125% | 66.67% |

All 64 genuine pairs survive blocking. E2b adds two description-dependent genuine suggestions but also four explicit false suggestions, so it does not establish overall F1 superiority and reduces precision. E5's train F1 is below E1; development F1 is above E1. No unannotated suggestions occur. E1 and E2b each produce four economically genuine suggestions contrary to authored ABSTAIN_INSUFFICIENT outcomes. E2b additionally suggests eight unmatched records through its four false pairs. All authored ambiguity cases abstain; no group-associated suggestions, forced ambiguity, duplicate consumption or financial eligibility violations occur in the measured run.

Threshold .90 and margin .03 were selected from the predeclared 12-point development grid. The selection ordering is the same objective as AI02 (minimize explicit false/unannotated proposals, maximize economic F1, conservative tie-break). E0/E1 settings, dataset labels and financial blocking were not retuned. The entire grid is retained. No held-out baseline/model evaluation was run. Existing AI01 integrity regressions may validate their held-out frozen artifacts, but neither AI03 loaders nor tuning/inference use them.

## Real inference, reproducibility and resource evidence

The real opt-in test loads pinned pretrained weights, verifies finite normalized 384-dimensional embeddings for English, Malay and mixed text, bypasses the cache for repeat inference, checks duplicate text, and executes a real overlength-input truncation test. Numerical stability tolerance is 1e-5, with actual deltas recorded in real-smoke.json. Seven warm repeats per split produce stable fingerprints, and a fresh worker reproduces the final training ranking fingerprint. Byte-identical floating-point output across different hardware is not required.

Model initialization, inference/IPC, warm ranking, fresh-worker end-to-end, cache statistics, actual forward-call counts and sampled worker RSS are recorded in [results.json](evidence/ai03/results.json). A fresh-process cold run includes model hashing/loading and uncached embeddings; OS file cache may still be warm. Only one cold observation was taken, so no cold p50/p95 is invented. Warm p50/p95 have seven samples. Warm cached E5 timings are not presented as cold-inference comparisons with E0/E1; baseline replay timing and the measurement-boundary differences are explicit.

No model weights, embedding cache or node_modules are committed or packaged. No external inference provider or financial-data upload was used.

## Executed verification

| Check | Actual result |
| --- | --- |
| Resume check after reviewing final ai03.test.ts assertion | 27 unit tests passed again, zero failed/skipped; inference results/timings were not regenerated |
| Final focused AI03 suite | 28 passed: 27 deterministic-provider unit tests + one real pretrained integration test; zero failed/skipped |
| Combined research/API/persistence/grouped/DB03 safety suite | 813 passed, zero failed/skipped, 36 files |
| Existing AI01 within combined suite | 213 passed |
| Existing AI02 within combined suite | 48 passed, frozen fingerprints reproduced |
| Native PostgreSQL within combined suite | 25 passed using isolated PostgreSQL 18.6 |
| TypeScript | Passed |
| Strict targeted ESLint | Passed, zero warnings/errors |
| Git/new-file whitespace | Passed |
| Existing manifests and 826 starting fingerprints | Passed unchanged |
| New review manifest and ZIP entry/byte checks | Performed during final packaging |

Counts overlap: the 813 combined tests already include AI01, AI02 and AI03; do not add them. The final focused run added an explicit low-support assertion inside an existing unit test after the combined run; no production or algorithm logic changed. All final assertions pass. The initial 26-unit-only report and early one-test smoke report are retained as historical development evidence; final focused-tests.json and regressions.json are authoritative for complete coverage. No skipped real inference is counted as a pass.

Commands from repository root on Windows PowerShell:

```powershell
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
$env:AI03_REAL = '1'
pnpm exec vitest run tests/reconciliation/ai03.test.ts tests/reconciliation/ai03-real.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai03/focused-tests.json
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai03/regressions.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai03 tests/reconciliation/ai03*.ts --max-warnings=0
git diff --check
git diff --cached --check
node research/reconciliation/ai02/verify.mjs
node research/reconciliation/ai03/verify.mjs
```

Approval-gated setup outside the repository used npm install --save-exact @huggingface/transformers@4.3.2 with ONNXRUNTIME_NODE_INSTALL_CUDA=skip, followed by pinned downloads verified before atomic finalization. Public metadata lookup initially encountered sandbox DNS restrictions; the normal approval mechanism allowed read-only metadata retrieval, then explicitly approved installation/download. Native regression execution similarly required loopback access outside the sandbox. The first TypeScript check found an untyped grid and a Node ForkOptions excess-property typing issue; both were corrected locally and full checks rerun. These initial failures were not hidden or counted as final passes.

## New files and purposes

| File | Purpose |
| --- | --- |
| research/reconciliation/ai03/types.ts | E2b/service contracts and predeclared grid |
| research/reconciliation/ai03/text-features.ts | Whitelisted text, vector validation and cosine |
| research/reconciliation/ai03/embedding.ts | Bounded batching/cache/deadline lifecycle |
| research/reconciliation/ai03/model-loader.ts | Killable local worker provider |
| research/reconciliation/ai03/model-worker.mjs | Pinned actual runtime, file verification and offline inference |
| research/reconciliation/ai03/model-config.json | Approved revision, precision and six file hashes |
| research/reconciliation/ai03/semantic-ranker.ts | Shared candidate pool, E2b ranking and assignment bridge |
| research/reconciliation/ai03/evaluation.ts | Unchanged AI02 metrics and forced-ambiguity reporting |
| research/reconciliation/ai03/experiment.ts | Real-only development selection and repeated runs |
| research/reconciliation/ai03/README.md | Usage, boundaries and reproduction |
| research/reconciliation/ai03/verify.mjs | Read-only package integrity verification |
| tests/reconciliation/ai03.test.ts | Dependency-independent unit tests, explicitly not real inference |
| tests/reconciliation/ai03-real.test.ts | Actual offline smoke, numerical replay, truncation and experiment |
| docs/reconciliation/ai03-evaluation.md | Actual comparison, safety and performance tables |
| docs/reconciliation/ai03-verification.md | This engineering report |
| docs/reconciliation/evidence/ai03/download.json | Pinned model download sizes/hashes |
| docs/reconciliation/evidence/ai03/runtime.json | Actual runtime, hardware and disk measurements |
| docs/reconciliation/evidence/ai03/runtime-package.json | Approved isolated dependency manifest copy |
| docs/reconciliation/evidence/ai03/runtime-lock.json | Approved isolated dependency lock copy |
| docs/reconciliation/evidence/ai03/real-smoke.json | Real embeddings, repeat stability and truncation evidence |
| docs/reconciliation/evidence/ai03/results.json | Grid, E2b metrics, runs, timings and baseline replay |
| docs/reconciliation/evidence/ai03/selected-config.json | Frozen selected settings and model metadata |
| docs/reconciliation/evidence/ai03/unit-tests.json | Initial dependency-independent test evidence |
| docs/reconciliation/evidence/ai03/real-tests.json | Initial real smoke test evidence |
| docs/reconciliation/evidence/ai03/focused-tests.json | Final 28-test focused evidence |
| docs/reconciliation/evidence/ai03/regressions.json | 813-test combined evidence |
| docs/reconciliation/evidence/ai03/post-review-tests.json | Affected unit-test rerun after the capacity interruption |
| docs/reconciliation/evidence/ai03/checks.json | Preservation, package inventory and independent result audit |
| docs/reconciliation/ai03-integrity-manifest.json | Source/reference/artifact checksums |

The ZIP includes these additions and the unchanged AI02 review references needed to inspect/replay the experiment (including train/development inputs and interfaces). It excludes held-out input/truth, pretrained weights, dependencies, caches, secrets, real financial documents and database dumps. Source hashes normalize CRLF to LF; artifacts are byte-exact. It is a review overlay for the existing project, not a replacement application or dependency installer.

## Remaining risks and AI04 recommendations

Semantic similarity alone cannot establish counterparty identity, financial approval or sufficient evidence. A future independently approved AI04 verifier should enforce reviewed party/alias identifiers, evidence requirements, exact money/currency/direction/date policy, grouping constraints and human approval before any confirmation. The four false counterparty edges and four authored-abstention contradictions are concrete regression cases for that future work. No AI04 implementation is included now.

Synthetic scenario repetition, merchant phrasing, small development samples and threshold selection bias limit generalization. CPU FP32 results do not certify quantized/GPU behavior. The local worker/interface is a research boundary, not hardened hostile-input production infrastructure. Native memory has no hard total cap; peak RSS is sampled rather than continuously observed. Larger-scale candidate generation remains the unchanged simple AI02 Cartesian policy. Retention, access control, operational approval and final-test governance require separate decisions.

AI03 meets the requested local engineering milestone with real inference and honest adverse results. Independent review is the next step. AI04–AI07, DB04, hosted integration, HTTP APIs, production changes, GitHub publishing and Draft PR #2 updates were not started.

## Final resumption audit

The final ai03.test.ts change explicitly checks that a cosine-0.90 candidate is unresolved under threshold 0.95, with INSUFFICIENT_SUPPORT on both records. This is a unit assertion, not a model or policy change. On resumption, all 27 affected unit tests and strict lint/whitespace checks passed again. All six external model files were rehashed locally; no installation, download or inference experiment was repeated. All 826 starting-file hashes and the AI01/AI02 manifests remain valid. The stored E2b results were independently re-counted: 34 genuine and four explicit counterparty false suggestions, with four authored-abstention contradictions. Existing measured latency and real-inference evidence are preserved.
