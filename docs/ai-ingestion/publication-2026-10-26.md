# V2 architecture checkpoint and live-evaluation boundary

26 October 2026. Experimental feature branch: feature/v2-multimodal-ingestion.
Production remains the separately released main, bb283c1ebdcc1d56404c4fad8cc227b478a383bf.
This development checkpoint does not merge V2 into main or deploy it to production.

## Preserved implementation and security synchronization

Increment 01–03 extraction, financial rules, independent verifier, blueprint reuse,
held-out inputs, CLI tools, tests and reviewed historical evidence are preserved.
Checkpoint 5d79bf2eee97891bd3a4d4c32dce0df2e149708a records that implementation;
genuine model inference has not executed. Its ancestor dependency graph is historical,
not the current security baseline. Ordinary merge e13bfef6ff3e16bc11f5252458af792cbfc5ce22
incorporates released main with Next/eslint-config-next 16.4.1, Sharp 0.35.5 and
libvips 8.18.7 while preserving OpenAI-compatible SDK 7.39.0 and Zod 4.6.7.
No override, force resolution, rebase or history rewrite was used.

Registered CSV/PDF/XLSX/image inputs have Git attributes preventing line-ending
conversion. CRLF CSV and PDF structural whitespace are preserved, not cleaned.
The original Increment 01 client component is retained byte-for-byte in
components/ai-ingestion-01/finance-document.tsx, behind a local-development server
page guard. All experimental APIs reject production/hosted processing. Build traces
exclude local state, environments, caches, evaluation labels and documentation.

## Reproduce locally without inference

Use Node 24.x, pnpm 11.19.0 and the separately configured locked Python environment.
No Python environment or model weights are bundled in Git. Use offline model caches;
never download missing weights without separate authorization.

- pnpm install --frozen-lockfile
- pnpm test --maxWorkers=1
- FINSIGHT_WORKBOOK_PATH='../../datasets/originals/Datasets.xlsx' pnpm test --maxWorkers=1
- pnpm lint; pnpm typecheck; pnpm check:server-boundary; pnpm build
- node --conditions=react-server scripts/ai-increment-03.mjs doctor
- node --conditions=react-server scripts/ai-increment-03.mjs evaluate
- node --conditions=react-server scripts/ai-increment-03.mjs evaluate --regression
- node scripts/ai-demo-03.mjs, then http://127.0.0.1:3107/ai-ingestion/live

Keep all dispatch flags 0 and HF_HUB_OFFLINE=1 / TRANSFORMERS_OFFLINE=1 for offline
verification. CLI defaults to no inference even if activation flags were inherited.
The live finance page has no recorded fallback; developer replay remains separate.
Use one OCR worker at a time on the 16 GB Mac. Do not delete quota files to retry.

After building, start a local production server, deliberately retaining local enable
flags, then run node scripts/verify-ai-production-isolation.mjs http://127.0.0.1:3118.
It verifies all three pages return 404, all API GET/POST attempts are denied, and no
private runtime state or evaluation labels occur in any production file trace.
This check never uploads a document or calls a provider. Production remains forbidden
for this V2 checkpoint even if those protections pass.

## Exact secure action before the first genuine run — not performed

1. Owner separately authorizes secure Groq configuration. In the official Groq console,
   verify Free Plan, model permissions for openai/gpt-oss-20b, exact organization quotas,
   and data-control/retention settings. Do not upgrade or attach a paid fallback.
2. Owner supplies a dedicated restricted key using an approved secure local mechanism,
   never chat, Git, screenshots or CLI arguments. If an environment file is selected,
   separately approve that destination; verify Git exclusion, no symlink/overwrite and
   owner-only permissions before writing. Previously declined flows are not retried.
3. Reconcile actual account quotas with the conservative ledger before dispatch. Current
   local caps: 30 RPM, 1,000 RPD, 8,000 TPM, 160,000 TPD, 64 total attempts. No automatic
   retries, ledger resets or refunds of unknown dispatches. Other organization traffic
   also consumes provider quota. Lower account limits require adjustment before any run.
4. Obtain explicit authorization to transmit ONLY the registered h01.csv synthetic
   source evidence and versioned rules to Groq for ONE request, no retries, no paid usage.
   Set the free-plan and dispatch authorization declarations only after these checks.
5. Run node --conditions=react-server scripts/ai-increment-03.mjs run
   public/samples/ai-ingestion-increment-03/h01.csv --live in the secured process.
   Retain receipt, actual model/token counts, quota reservation, response hash, timings,
   financial verifier outcome and all failures. Unknown outcomes stop further dispatch.
   Further XLSX/PDF/image evaluation needs appropriately scoped dispatch authorization.

Public vendor documentation checked 26 October 2026 lists this model with strict JSON
schema support and Free Plan summary limits of 30 RPM / 1K RPD / 8K TPM / 200K TPD;
these are not authenticated account guarantees. The local daily cap is lower. Model
pricing docs are informational, not spending authorization. Strict JSON compliance
never proves financial accuracy. Actual model availability, free access, effective
account quotas and data-control settings remain unverified without secure setup.

References: [model](https://console.groq.com/docs/model/openai/gpt-oss-20b),
[strict outputs](https://console.groq.com/docs/structured-outputs),
[rate limits](https://console.groq.com/docs/rate-limits),
[data controls](https://console.groq.com/docs/your-data).

## Evidence and boundaries

Existing dated Increment 01–03 reports are historical and remain unchanged. Current
publication logs, new extraction metrics, browser screenshots, before/after audit,
source hashes and review ZIP are under the canonical workspace evidence/reviews folders.
Static reviewed synthetic documentation/evidence is versioned; fresh run reports,
quota ledgers, secrets, environments, caches, personal datasets and archives are not.
Ground truth is evaluation-only, never runtime prompt input. V2 financial records remain
experimental and must not be cast into C1/C2. No financial policy, canonical contract,
normalization, hosted database, authentication or production change is implied.

The standalone Node ESM large-workbook WORKBOOK_CONTENT / u8 issue remains a separate
open investigation. Scale verification uses the supported file-based Vitest harness.
Windows/Ollama/GPU execution and genuine model accuracy remain unmeasured.

## Executed verification for this checkpoint

Configured serial suite with the 6,000-row workbook: **526 passed / 8 skipped**,
47 test files passed / 1 skipped. The eight skips are native PostgreSQL tests, not
PDF/OCR tests. Actual Python extraction tests ran; pip check reported no broken
requirements. Frozen install, lint, typecheck, server-boundary and production build
passed. The separate three-run scale harness preserved all 6,000 exact financial
values, IDs, dates and directions through C1 in 434.39 / 434.48 / 468.14 ms
(read bytes before timing; assertions afterward; warmed same-process runs).

Extraction-only CLI: held-out 8 documents, 87/87 exact literal fields, 29,541 ms
summed document runtime; regression 26 documents, 242/276, 68,108 ms. The deliberate
corrupt PDF returned PROCESSING_FAILED and remains in the results. These timings
include extraction and blocked-inference preparation, not hosted-model latency.
Genuine inference runs 0, provider tokens 0, estimated spending US$0, model accuracy
NOT_MEASURED. RECORDED_TEST verifier controls remain separate from live results.

Audit: 2 critical / 7 high / 12 moderate / 2 low before → 0 critical / 4 high /
7 moderate / 1 low after; 11 advisory IDs removed, none added. Audit exits 1 and is
not clean. Noncritical source-map-js and development-tooling advisories remain.

A real local production HTTP regression initially failed: the legacy UI rendered
and file traces contained ignored AI state. After the guard/exclusions, all three
UI routes return 404, all six API GET/POST probes are denied (legacy API 403, newer
APIs 404), and private/evaluation trace matches are 0 with local enable flags set.
Next still emits broad dynamic-file tracing warnings; private exclusions and the
trace checker pass, but overall trace-size optimization remains future work. No
warning was suppressed. No V2 production deployment is authorized by these checks.
