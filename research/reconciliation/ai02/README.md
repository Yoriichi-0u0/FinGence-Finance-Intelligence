# AI02 deterministic and fuzzy research baselines

Algorithm ai02/1.0.0, approved dataset ai01-m2/1.1.0. This is isolated local research, not a financial approval service. No dependencies were added.

## Boundaries and use

Pass an approved raw training/development SplitInput through `prepareDevelopment` in adapter.ts. It reuses AI01 `developmentCandidates` to validate synthetic eligibility, source conventions and split identity and projects only approved fields. Pass the resulting Input to `runBaseline(input, "E0" | "E1", config)`. The core does not import the adapter, authoring functions, truth or evaluator. Direct projected-input calls are trusted research/test interfaces, not production authentication or provenance attestation. Runtime guards reject extra fields, duplicate IDs, invalid money/dates/config and held-out splits.

```typescript
import { prepareDevelopment } from "./adapter";
import { runBaseline } from "./run";
import { EXACT_CONFIG } from "./types";
const result = runBaseline(prepareDevelopment(rawTrainingInput), "E0", EXACT_CONFIG);
// result.suggestions are proposals requiring later verification, never approvals.
```

The rawInput variable must come from the existing frozen training/development input, never a complete benchmark with annotations. Fuzzy configuration is explicit; use the frozen configuration.json in docs/reconciliation/evidence/ai02/ for replay. E0 and E1 use the same financial/date pool. Identity sorting only makes outputs stable; tied evidence always abstains. Money uses the existing exact-decimal BigInt utility, never Number arithmetic.

## Reproduce evidence on Windows

From the repository root, with installed project dependencies:

```powershell
$env:AI02_WRITE_EVIDENCE = '1'
pnpm exec vitest run tests/reconciliation/ai02-evaluation.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1
Remove-Item Env:AI02_WRITE_EVIDENCE
# This intentionally refreshes AI02 results/configuration only, never any AI01 fixture.
# Normal test runs without the flag do not rewrite frozen evidence.
node research/reconciliation/ai02/verify.mjs
```

For a sandbox with an unwritable default cache directory, set TEMP and TMP to a writable local temporary directory outside the repository. Native regression tests require loopback access to freshly initialized disposable databases. No real environment files or hosted credentials are needed. Manifest verification is intentionally expected to fail after an evidence refresh until a reviewer regenerates the AI02 manifest with current hashes.

## Modules

- types.ts: independent research contracts and explicit date policy.
- adapter.ts: existing AI01 validation/projection bridge, no ranking.
- candidates.ts: strict projected-input validation and shared exact financial blocking.
- scoring.ts: Unicode lexical normalization and token/bigram Dice.
- exact.ts and fuzzy.ts: independent scoring functions.
- abstention.ts: mutual unique support and one-to-one conflict prevention.
- run.ts: orchestration, explanations, tie-aware ranks, timing and fingerprint.
- evaluator.ts: separate economic/operational metrics; no matcher imports it.
- experiment.ts: development-only fixed threshold grid and timed replay.
- verify.mjs: read-only source/artifact integrity verification.

See the [baseline specification](../../../docs/reconciliation/ai02-baseline-spec.md), [evaluation report](../../../docs/reconciliation/ai02-evaluation.md) and [engineering verification](../../../docs/reconciliation/ai02-verification.md). AI03–AI07 are not implemented. The final held-out evaluation remains deferred.
