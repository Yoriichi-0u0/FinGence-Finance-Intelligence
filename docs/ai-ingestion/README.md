# FinGence 2.0 local AI ingestion experiment

20 October 2026. Synthetic data only. This branch is a first increment, **not a completed live-AI demonstration**. Secure credential destination confirmation was declined twice. No API key was created or written. No live OpenAI request, input/output token usage or API spending has occurred. The local page performs real extraction, then visibly blocks the unavailable inference and dependent stages. It never substitutes simulated AI.

## Start the demonstration

Use Node 24.x, pnpm 11.19.0 and Python 3.12. The verified machine used Node 24.22.0, Python 3.12.14, macOS arm64 and 16 GiB RAM. These commands are from the experiment's repository root:

```bash
pnpm install --frozen-lockfile
python3.12 -m venv .venv-ai
.venv-ai/bin/python -m pip install -r requirements-ai-lock.txt
.venv-ai/bin/python -m pip check
pnpm ai:doctor
pnpm ai:demo
```

Open **http://127.0.0.1:3103/ai-ingestion**. The launcher binds only to loopback. Python packages and model caches require downloads on first use. A compatible first-ever setup needs network access; after caching, extraction does not call a cloud parser. Native packages and model licenses require review on another platform. The Python lock is the tested macOS environment, not proof of Linux/Windows installation.

The launcher and evaluation CLI set `FINGENCE_AI_PYTHON` to the local virtual environment's interpreter. The worker is an external local runtime; it is not traced or bundled into Next.js production output.

Choose a sample, or upload the identical sample bytes from `public/samples/ai-ingestion/`. The upload boundary accepts only registered SHA-256 synthetic fixtures. Arbitrary financial uploads are intentionally disabled. The maximums are 10 MiB, four PDF pages, 12 megapixels per image, four worksheets, 50 financial rows in total and 16 spreadsheet columns. Worker runtime/output and schema limits also apply. Large or ambiguous sources fail or remain unresolved.

1. Use CSV, Excel, digital PDF, scanned PDF, PNG and JPEG examples. Mixed digital/scanned PDF is also in the sample directory for file upload.
2. Select **Run document processing**. Inspect actual source values, page/region or sheet/cell references and extraction timing.
3. Show the separate stages. **AI document understanding is BLOCKED** without credentials. Rule synthesis, verification and accepted records do not pretend to have run.
4. Download the evidence JSON. It contains the exact source hash, evidence, stage states and unavailable inference receipt.
5. Show the low-quality image. Extracted regions are not promoted into financial records.
6. Use **Open verified FinGence 1.0** to demonstrate the existing deterministic workflow independently. Do not imply V2 output is already integrated with C1/analytics/persistence.

The page is a finance-oriented local experiment. The hash allowlist and loopback checks are PoC controls, not authentication or a production security boundary. No hosted storage, persistence, RBAC, reconciliation or accounting advice is implemented here.

## Reproduce extraction and independent checks

```bash
pnpm ai:extract public/samples/ai-ingestion/statement-scan.pdf
pnpm ai:benchmark
pnpm ai:evaluate
pnpm ai:evaluate --recorded-test
pnpm test:ai
```

`ai:benchmark` compares real local extraction only and writes `docs/research/extraction-benchmark.json`. `ai:evaluate` uses the actual provider path; when credentials are missing it records **NOT_EXECUTED**, zero accepted records and no invented model output. `--recorded-test` explicitly injects hand-authored test proposals through the real verifier. Its outputs are **not evidence of LLM accuracy**. Full local reports are in ignored `.ai-local/`. Never erase its budget ledger to obtain more paid requests.

Ground truth is evaluation-only under `tests/fixtures/ai-ingestion/`; neither the real provider nor verifier imports the labels. Test proposals live only in the test helper and opt-in CLI. Browser mode has no simulated-provider option. Identical transactions appear in several file formats; do not add their counts as unique transactions.

## Live AI prerequisites — currently incomplete

The intended experimental project and key must be provisioned through the official secure flow, after separate destination approval. **No credential is present.** Do not paste keys into chat, source, logs, screenshots or commands. A future approved `.env.local` must remain Git-ignored, not a symlink, newly created with owner-only `600` permissions and never overwritten silently. The experimental project must use only required permissions. Provider-side spending controls, billing and account access remain unconfigured/unverified.

The implemented provider requires `OPENAI_API_KEY`, `OPENAI_PROJECT_ID` and `FINGENCE_AI_LIVE_APPROVED=1`. Next and the CLI load the ignored local environment file; only server code reads the key. The configured candidate is `gpt-6.1-sol`; **no model has actually been used for live inference**. Account availability, the full token-count/structured-output/vision API path and real LLM accuracy have not been verified. Public model/pricing documentation is not account access evidence.

Before generation the provider checks the explicit model, current official pricing, input token count and persistent budget reservation. A price/model/counting failure stops dispatch. PDF/images include their actual visual bytes alongside extracted evidence. No model tools are enabled; responses use `store:false`, bounded output and no automatic SDK retries. These code paths have mock-SDK safety tests only. `store:false` is not a guarantee of zero provider retention.

## Budget

The shared CLI/browser `.ai-local/budget.json` ledger uses an exclusive lock and atomic owner-only writes. Every request reserves **US$0.15 permanently** before dispatch; timeouts/unknown outcomes retain the reservation and are never automatically retried. At the checked standard pricing assumption of US$2/M input and US$10/M output, 32,000 input plus 6,000 output tokens costs at most US$0.124. The larger reservation adds headroom. The 34th reservation is blocked: maximum reserved spending is **US$4.95**, below the approved US$5.

Actual token counts and estimated spending are retained when returned. Estimated cost is not an invoice. A stale lock, corrupt ledger or symlink fails closed. The cap is application-local; it does not control other API clients or protect against someone deleting/editing the ledger. No provider-side hard cap has been configured. Never bypass the ledger or manually retry an uncertain charge.

Current actual usage: **0 live requests, 0 tokens, US$0 estimated spend, US$0 reserved**. Mocked request reservations in isolated temporary test directories are not paid API use.

See the [architecture and verification boundary](architecture.md), [executed checks](verification.md), [Week 06 contribution evidence](week-06-evidence.md) and [technology evaluation](../research/open-source-technology-evaluation.md).
