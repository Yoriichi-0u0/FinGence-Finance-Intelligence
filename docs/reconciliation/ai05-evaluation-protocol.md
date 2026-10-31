# AI05 official evaluation protocol — frozen before labels

Protocol ai05-official/1.0.0. Dataset ai01-m2/1.1.0. One official held-out prediction attempt and one subsequent isolated label evaluation. No threshold selection, model changes, verification-rule changes or dataset changes follow the held-out results.

## Compatibility authorization

The user explicitly authorized minimal separately versioned held-out compatibility after preflight demonstrated that the existing AI02/AI03 candidate entry point and AI04 entry points deny heldout. The initial preflight report remains as historical evidence of that blocker. The new ai05-heldout-adapter/1.0.0 resolves it without modifying AI01–AI04 files or relabeling inputs.

The adapter calls AI01 heldoutCandidates for the official source and developmentCandidates for parity tests. That validates the source-only schema, exact values, provenance and eligibility and returns permitted ranking fields. AI05 preserves the split string heldout throughout.

Candidate construction composes the unchanged AI02 blockedReason and epochDay checks over all bank/ledger rows. E0/E1 reuse exactScore, fuzzyScore and resolve. E5 reuses semanticText, cosine, the original Embeddings and LocalE5Provider and resolve. Its orchestration preserves mean pooling, L2, CPU FP32, 384 dimensions, query prefixes and score-rounding/tie rules. AI04 orchestration reuses unchanged sourceChecks, financialChecks and identityChecks plus the identical complete-cohort, competition, assignment and disposition conditions. No label, case ID, score override or novel financial rule is introduced.

Only static TypeScript bridges are used where older types exclude heldout: the shared resolver does not inspect split, and sourceChecks indexes the existing TEMPLATES/PERIODS declarations which already contain all four held-out schemas and the held-out period. Actual runtime split values are never changed. AI05's WeakSet boundary accepts only projections returned by the approved AI01 source interface. Deep freezing preserves source evidence. Existing training-only guards remain intact.

Before the official attempt, train/development tests must reproduce all four E0/E1 saved run fingerprints, identical E5 ranking fingerprints with deterministic injected vectors, and exact AI04 decisions/fingerprints for all saved E0/E1/E5 proposals. Unit vectors are parity-test evidence only. Official predictions require the actual PRETRAINED_E5 provider.

## Frozen configuration

- E0: existing saved AI02 configuration, exact-reference score, threshold 1, margin 0.
- E1: existing saved configuration, threshold .95, margin .20; unchanged lexical weights and counterparty contradiction guard.
- E2b: saved AI03 selected configuration, threshold .90, margin .03; pinned model/tokenizer revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, unchanged CPU FP32 runtime and text rules.
- All use exact money, currency, explicit direction and inclusive two-day canonical-date blocking.
- AI04: ai04-policy/1.0.0, exact reference and counterparty evidence, complete split cohort, conservative competing-partner abstention, one-to-one assignment and no grouping/partial aggregation.
- Metrics: ai05-metrics/1.0.0 formulas below, source-fingerprinted before label loading.

buildFreeze validates the saved configurations, dataset/input hashes, installed runtime version and all six model file hashes. It captures normalized SHA-256 of reconciliation software, byte-exact dependency locks/configuration/protocol/test driver, model metadata, hardware/software and measurement options. It never parses any label file. Dataset artifact metadata includes the pre-existing expected truth hash. The manifest contains no tuned parameter or inferred result.

## Required sequence

1. Run parity/adversarial/freeze unit tests using training/development or injected truth only; run TypeScript and strict lint.
2. Invoke the prediction stage explicitly. An exclusive official directory and write-once files prevent overwriting an existing attempt. Save freeze.json and validate it before source loading/inference.
3. Load held-out source through heldoutCandidates. Execute E0, E1, actual E5 and independent verification. No annotation file is loaded by the prediction process.
4. Keep the first prediction of each method as the official run. Perform seven fixed warm replays solely for latency/determinism, never selection. Verify identical proposal/decision fingerprints. Make one extra uncached E5 sample call for numerical stability with predeclared tolerance 1e-5; no ranking/threshold is changed.
5. Revalidate the freeze, save complete predictions.json, and save prediction-seal.json binding its bytes to the freeze. Close the model worker. Any failure is retained in prediction-failure.json; no automatic retry or partial pass is allowed.
6. In a separate process, the evaluator verifies sealed bytes, current source/configuration and model integrity before any label parse. It prepares the source view first, then loads the evaluation-only truth and calls AI01 heldoutAnnotations for validated read-only labels. Existing train/development labels are loaded only here to satisfy AI01's complete benchmark validation contract.
7. Compute and write evaluation.json exclusively. An existing evaluation is never overwritten. Later regression/reproducibility checks inspect sealed artifacts and synthetic fixtures; they do not rerun the official experiment or retune.

The evaluator is a module/process boundary within a local research checkout, not an OS-enforced data access sandbox. Matchers/model workers never receive truth. Frozen datasets and saved historical results remain untouched.

## Metrics and populations

PAIR relationships only define genuine pair recall; GROUP/PARTIAL are separate unsupported populations. Explicit false positives are only annotated negative edges. All other suggested edges are unannotated, not silently false. Precision is TP/(TP+explicit FP); recall is TP/all genuine PAIR relationships; F1 is their harmonic mean. Undefined denominators return null. Report counts beside percentages.

Blocking recall is genuine pairs in the shared candidate pool divided by all genuine pairs. Recall@1/3/5 uses the existing pessimistic worst equal-score bank rank over that same denominator. AI04 does not rerank, so retrieval is reported once per method and before/after final suggestion metrics are separate.

Coverage is unique suggested bank records/all bank records; unresolved ratio is the remaining fraction. Verification reports retained correct pairs, withheld explicit false and genuine pairs, VERIFIED_SUGGESTION/BLOCKED_PROPOSAL/UNRESOLVED_REVIEW proposal counts. Proposal dispositions do not account for all unresolved source records; the record-level coverage denominator does.

Report financial amount/currency/direction/date violations, counterparty conflicts, missing identity, unknown source/financial evidence, duplicate consumption, grouped associations, unmatched records suggested, forced ambiguity and authored-abstention contradictions independently of economic precision. Economic truth does not override authored operational abstention.

## Measurement boundaries and interpretation

The first pipeline observation includes candidate construction, ranking/embedding, fingerprints and AI04 verification. E5's first embedding includes initialization, model integrity checks, loading and CPU inference. Source loading/projection, freeze validation, label evaluation and evidence file writes are outside per-method timing. Component intervals may nest: initialization is part of embedding, not an extra additive interval.

Seven warm pipeline replays include verification/fingerprints; E5 uses its existing bounded embedding cache. Report p50/p95 and all samples, with p95 the maximum of seven observations. One cold E5 observation cannot establish cold p50/p95. Fresh worker does not imply cold OS file cache. Sampled worker RSS is not continuous/system peak; the JS heap cap does not cap all native memory. Distinguish service embedding calls/cache misses from one additional direct numerical-check call.

Report measured synthetic held-out performance only. No statistical significance is claimed. The 100 records and four unseen schemas cannot establish production accuracy, client accounting approval, trusted provenance or automated accounting authority. No aspirational project accuracy target is claimed without a matching defined metric.

## Commands

From the existing checkout in PowerShell, with writable TEMP/TMP pointing to ../ai01-m2-temp and the already approved runtime/model outside Git:

```powershell
$env:AI05_STAGE = 'predictions'
pnpm exec vitest run tests/reconciliation/ai05-official.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/prediction-tests.json
node research/reconciliation/ai05/verify.mjs --model
$env:AI05_STAGE = 'evaluation'
pnpm exec vitest run tests/reconciliation/ai05-official.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai05/evaluation-tests.json
Remove-Item Env:AI05_STAGE
```

These commands are intentionally one-shot. Do not rerun them over an existing official directory. A technical failure requires an explicitly documented separate attempt preserving the original; a completed official result is never replaced. No real model download, external inference, hosted database, migration, API, GitHub publishing, AI06/AI07 or DB04 is authorized.
