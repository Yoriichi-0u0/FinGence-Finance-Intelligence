# AI05 final held-out evaluation

AI05 is a frozen offline research experiment, not an ingestion service, API or accounting approval workflow. The official prediction and evaluation artifacts already exist. Do not rerun the one-shot stages over them.

The user separately authorized ai05-heldout-adapter/1.0.0 after the old entry points demonstrably rejected heldout. All AI01–AI04 and DB01–DB03 files remain unchanged. The adapter composes the unchanged financial blocking, exact/fuzzy scorers, E5 runtime/text/cosine, assignment resolver and AI04 source/financial/identity checks. Its scope-aware orchestration preserves all checks and actual split identities. Historical baseline fingerprints, semantic injected-vector fingerprints and verification decisions are regression-tested for exact parity.

Modules:

- types.ts: explicit held-out-capable research contracts and adapter version.
- preflight.ts: preserved old-entry-point capability probes and preparation snapshot; intentionally still shows the original guards reject heldout.
- adapter.ts: approved AI01 projections, shared candidates, unchanged baseline/E5 ranking and AI04 rule orchestration.
- freeze.ts: reviewed configuration, software, model and source integrity seal; no label parsing.
- prediction-runner.ts: exclusive one-shot actual offline prediction attempt, seven fixed warm replays and prediction seal; no truth loader.
- heldout-evaluator.ts: sole official label-loading stage in a separate process after seal validation; calls the existing evaluation-only AI01 interface.
- metrics.ts: pure economic/retrieval/operational metrics; labels stay in evaluation.
- verify.mjs: read-only freeze/artifact/replay/manifest verification, optionally all six external model hashes.

See docs/reconciliation/ai05-evaluation-protocol.md for the pre-label protocol and exact measurement definitions, ai05-results.md for actual results and ai05-verification.md for the engineering report. Full per-candidate proposals and individual AI04 checks are in docs/reconciliation/evidence/ai05/official/predictions.json. Held-out truth remains only in the original AI01 evaluation-only artifact location, outside the review ZIP.

Normal verification from the existing repository:

```powershell
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
$env:AI05_STAGE = ''
$env:AI03_REAL = '0'
$env:AI02_WRITE_EVIDENCE = '0'
$env:AI04_WRITE_EVIDENCE = '0'
$env:AI05_WRITE_PREFLIGHT = '0'
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/ai05 tests/reconciliation/ai05*.ts docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs --max-warnings=0
node research/reconciliation/ai05/verify.mjs --model
# Read-only post-seal audit, not a second official model experiment:
node docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs
```

The combined suite intentionally skips the two one-shot official stages and the historical AI03 evidence-writing model test. Both AI05 stages have their own completed test reports. No installation/download or hosted database connection is needed. Native regression tests create disposable local clusters.

The ZIP overlays the existing repository. It contains source, tests, reviewed interfaces, predictions, metrics, reports and integrity metadata, but no copied truth sidecars, raw source fixtures, model weights, dependencies, caches or database artifacts. Reproduction/auditing uses the original hash-matched fixtures. Research policy remains conservative: no unsupported grouping, partial aggregation, FX, source-authentication claims or automatic accounting confirmation. AI06/AI07 and DB04 require further contract approval.
