# AI01 M1 synthetic reconciliation research

This isolated Node/TypeScript module generates synthetic research data, not accepted ingestion data, V2 verified input, financial advice or a reconciliation approval. It has no production imports, database integration, network calls, model inference or new dependencies. All companies/accounts/files are synthetic; provenance filenames identify logical source views, not real uploaded documents.

## Use

```ts
import { generateDataset, serializeDataset, datasetFingerprint } from "./generator";
import { assertValidDataset } from "./validator";

const dataset = generateDataset({ seed: "fingence-ai01-pilot-001" });
assertValidDataset(dataset);
const json = serializeDataset(dataset);
const sha256 = datasetFingerprint(dataset);
```

Use an existing TypeScript consumer or Vitest. No additional CLI/package/runtime is required. The frozen default-seed JSON at [fixtures/pilot-dataset.json](fixtures/pilot-dataset.json) is directly usable without executing TypeScript. It contains **records and privileged ground truth**: provide only `records` to future candidate algorithms, withholding groundTruth and fixture expectations. Stable provenance and IDs remain necessary but must not be ranking features.

From the repository root on Windows PowerShell:

```powershell
pnpm exec vitest run tests/reconciliation --maxWorkers=1
pnpm typecheck
pnpm exec eslint research/reconciliation tests/reconciliation
```

Ordinary snapshot tests read the frozen fixture. An intentional generator/annotation change requires review, a version decision, then explicit `pnpm exec vitest run tests/reconciliation/generator.test.ts --maxWorkers=1 --update`. Do not silently regenerate evidence to conceal regressions. `pilot-expectations.json` supplies separately specified counts; a generated snapshot is a regression anchor, not an independently proven economic oracle.

## Modules

| File | Responsibility |
| --- | --- |
| types.ts | Research-only transaction, provenance and separated annotation contracts |
| schemas.ts | Four explicit source/account/direction/date conventions |
| decimal.ts | Bounded exact decimal syntax and BigInt-scaled comparison/addition |
| ground-truth.ts | Authored event scenario board and annotation rendering by record ID |
| generator.ts | Seeded records, opaque IDs, stable ordering, canonical JSON and SHA-256 |
| validator.ts | Independent financial, lineage, shape and annotation consistency checks |
| pilot-annotations.ts | Independent M1 revision-specific required negative edges/reasons; evaluator-only |
| fixtures/ | Frozen synthetic dataset and independent expected pilot distribution |

No `IngestionResult`, legacy VALID/WARNING flag or existing API service is consumed. Runtime validation supports internal plain JSON research fixtures; it is not a hostile-object security boundary. No value is repaired or silently converted.

Review revision 1.0.1 adds pilot annotation completeness and equalizes recurring-candidate date evidence. It preserves the original seed namespace, monetary fields and record identities. The required-edge manifest is not a universal five-negative rule; additional consistent negatives are allowed. IDs/provenance/template conventions are interpretation and identity context, not matching tie-break evidence. See the specification for the complete experimental input boundary.

See the [dataset specification](../../docs/reconciliation/ai01-dataset-spec.md), [annotation guide](../../docs/reconciliation/annotation-guide.md) and [engineering verification](../../docs/reconciliation/ai01-verification.md). Stop after M1: no AI02 matching or full dataset expansion is implemented.
