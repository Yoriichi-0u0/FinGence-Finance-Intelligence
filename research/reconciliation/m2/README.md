# AI01 M2 synthetic benchmark

Version `ai01-m2/1.1.0`, seed `fingence-ai01-m2-frozen-001`. This is a separate 300-record benchmark; the reviewed 40-row M1 pilot and all its files remain historical and unchanged. The benchmark is synthetic research data, not approved ingestion V2 data, production accounting or model output.

## Use and boundaries

`generateBenchmark(seed)` is an **author/evaluator-only** API producing all three splits and privileged truth. It is not a candidate-ranking input API. `frozenArtifacts(benchmark)` produces nine canonical JSON artifacts in memory. The frozen files under fixtures/ are the default independent-review deliverable.

For tuning, load only fixtures/inputs/train.json or development.json and call `developmentCandidates(input)`. It rejects held-out templates, wrong splits, extra fields and direct annotation contamination. Candidate addressing IDs/roles are outside the whitelist-only `features` object. `heldoutCandidates(input)` is explicitly evaluator-only and carries no labels. `heldoutAnnotations(benchmark)` returns a recursively frozen copy for the future evaluator. None of these functions matches transactions, computes scores/metrics or approves reconciliation.

Held-out labels live at fixtures/evaluation-only/heldout-truth.json. Never load that file or the full authoring API into training, threshold selection, prompts or a ranker. Filesystem possession of the review ZIP is not an access-control boundary; reviewers and future evaluation owners must enforce this experimental protocol.

## Local commands (repository root, PowerShell)

```powershell
pnpm exec vitest run tests/reconciliation --maxWorkers=1
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/m2 tests/reconciliation/m2-generation.test.ts tests/reconciliation/m2-validation.test.ts tests/reconciliation/m2-access.test.ts tests/reconciliation/m2-artifacts.test.ts
```

Normal tests read frozen artifacts. For an explicitly reviewed version/fixture change only:

```powershell
pnpm exec vitest run tests/reconciliation/m2-artifacts.test.ts -t "matches nine deterministic" --maxWorkers=1 --update
pnpm exec vitest run tests/reconciliation/m2-artifacts.test.ts --maxWorkers=1
```

Vitest flushes snapshot files at the end of the authoring run. Run the independent frozen-file check afterwards; do not assume a passing snapshot-authoring assertion means files were already available to other tests in the same run. These commands select only M2 artifacts and never update M1.

## Modules

| File | Role |
| --- | --- |
| types.ts | Research records, split input, truth and eligibility contracts |
| schemas.ts | Twelve source definitions, frozen split/period allocation and source blocks |
| scenarios.ts | Author-only economic event board, independent of future algorithms |
| annotations.ts | Separately specified required M2 labels and source-row coverage |
| generator.ts | Seeded record/truth rendering and separate rejected-input examples |
| serialization.ts | Canonical JSON, SHA-256 and seed validation |
| features.ts | Explicit whitelist of permissible financial/text/date evidence |
| validator.ts | Financial, annotation, source, eligibility and cross-split checks |
| access.ts | Purpose-specific immutable candidate/evaluator views |
| artifacts.ts | Frozen split artifact creation and independent verification |
| fixtures/ | Three input files, three separate truth files, rejected inputs and two manifests |

The only shared M1 implementation primitives are exact decimal helpers, calendar validation and role/direction types. No production ingestion, API, persistence or security module is imported. No dependency was added. The [specification](../../../docs/reconciliation/ai01-m2-dataset-spec.md), [split protocol](../../../docs/reconciliation/ai01-m2-evaluation-splits.md) and [engineering report](../../../docs/reconciliation/ai01-m2-verification.md) define the benchmark's limits.

## Benchmark quality correction (30 October 2026)

Version 1.1.0 preserves all schemas, row allocations and economic relationships. B/C/D now provide 18 description-dependent suggestions with same-value competitors and missing/differing references. The 30 ambiguous-pair abstentions remain intact. Run `node research/reconciliation/m2/diagnostics.mjs` from the repository root for a read-only frozen-input shortcut audit. This diagnostic is not an AI02 matcher. See the updated engineering report for before/after counts and limitations.
