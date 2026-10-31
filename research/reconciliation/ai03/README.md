# AI03 local Multilingual E5 Small ranker

Node-only research, algorithm ai03/0.1.0. Actual pretrained inference was verified locally; this is not a production reconciliation service. AI01/AI02 and project dependencies remain unchanged.

## Runtime and inputs

The separately approved runtime is @huggingface/transformers 4.3.2 with ONNX Runtime 1.30.0. Model: Xenova/multilingual-e5-small, revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, FP32 CPU. Exact model/tokenizer file hashes are in model-config.json. The ONNX publisher identifies it as the conversion of [intfloat/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small). The [original model card](https://huggingface.co/intfloat/multilingual-e5-small) documents the symmetric query prefix, mean pooling, normalization, 384 dimensions and 512-token limit.

Use the unchanged AI02 prepareDevelopment(rawInput) adapter on training/development input. rankSemantic consumes that projected Input and the unchanged generateCandidates financial/date pool. Only NFKC-normalized, whitespace-collapsed description and optional counterparty reach the worker, prefixed with `query: ` on both sides. Case and punctuation remain. No amount, currency, date, reference, role, ID, source coordinate, split or annotation is embedded. Financial features independently determine eligibility.

LocalE5Provider launches a child Node worker. It loads the exact installed library from a sibling directory, verifies every pinned model file, forbids remote model loading and replaces worker fetch with a rejecting function. The worker uses the pinned library's attention-mask-aware mean pooling and L2 normalization. Its tokenizer configuration is verified to have model_max_length=512. The library feature-extraction implementation truncates at that configured limit; pre-truncation token counts are separately measured. No external inference provider is used.

Embeddings initializes once per service, deduplicates text, uses an LRU cache (512 entries), batches at most eight texts by default, validates finite 384-dimensional nonzero vectors and returns defensive copies. Concurrent service requests are rejected to bound in-flight work. Each load/inference/disposal has a 120-second default deadline; timeout or failure closes the service and terminates its worker. No automatic retry is performed. Model resources are disposed then the child is terminated. The worker's JS heap is capped at 2 GiB; this is not a hard cap on native ONNX memory.

E2b scores raw cosine, rounded to six decimal places for ties/rank fingerprints. Scores are not probabilities. AI02's mutual top-candidate assignment is reused without editing it. A structural bridge uses AI02's existing score shape internally because its resolver/evaluator ignore method tags; public results remain E2b and never execute fuzzy scoring. AI02 metrics and denominators are reused unchanged. Equal/near-equal support, low scores and assignment conflicts abstain. Group aggregation is unsupported.

E1's exact counterparty mismatch veto is deliberately not copied: semantic counterparty text is evidence rather than an exact identity rule. This preserves the financial candidate pool but changes scoring support, and caused four explicit counterparty false suggestions in the measured splits. That adverse result is recorded, not hidden. No result is an accounting approval.

## Reproduce on the current Windows workspace

Model/runtime paths are outside the repository:

- ../ai03-runtime/ — isolated package.json, package-lock.json and node_modules.
- ../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78/ — six pinned model/tokenizer files and download manifest.

```powershell
$env:AI03_REAL = '1'
$env:TEMP = (Resolve-Path '../ai01-m2-temp').Path
$env:TMP = $env:TEMP
pnpm exec vitest run tests/reconciliation/ai03.test.ts tests/reconciliation/ai03-real.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1
Remove-Item Env:AI03_REAL
node research/reconciliation/ai03/verify.mjs
```

The real test intentionally refreshes only AI03 smoke/experiment/config artifacts; afterwards an old evidence manifest will fail until consciously regenerated for review. Without AI03_REAL=1, the pretrained test is skipped and must never count as a real-inference pass. Ordinary unit tests explicitly inject UNIT_TEST_ONLY vectors. Missing local runtime/weights causes a BLOCKED error; there is no fake-inference fallback or automatic download.

For another workstation, obtain approval before installing/downloading. The isolated runtime package and lock copies are in evidence/ai03/. Use npm ci in a separate sibling runtime directory, with ONNXRUNTIME_NODE_INSTALL_CUDA=skip for this CPU experiment. Fetch exactly the six paths in model-config.json from https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/ and verify their SHA-256 values. Do not put weights or node_modules in the checkout. The current review ZIP deliberately contains neither.

## Files

- types.ts: separate E2b/service contracts and predeclared threshold grid.
- text-features.ts: approved text construction and vector validation/cosine.
- embedding.ts: bounded service, batching/cache and deadlines.
- model-loader.ts and model-worker.mjs: isolated real runtime, integrity and offline execution.
- semantic-ranker.ts: shared eligibility, E2b scores and unchanged assignment bridge.
- evaluation.ts: unchanged AI02 metrics plus forced-ambiguity diagnostic.
- experiment.ts: real-provider-only train/development selection and replay.
- model-config.json: approved pinned metadata and six file checksums.
- verify.mjs: read-only review-package integrity verification.

See [engineering verification](../../../docs/reconciliation/ai03-verification.md) and [comparison results](../../../docs/reconciliation/ai03-evaluation.md). No AI04–AI07, database integration, production configuration or HTTP endpoint is implemented.
