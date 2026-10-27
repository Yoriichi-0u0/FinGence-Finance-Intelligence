# FinGence — current local workspace

27 October 2026. The application and Git root are the same directory. The previous
container/checkouts layout is historical. Read [CURRENT.md](../handoff/CURRENT.md)
for stable C1/C2 and experimental V2 contracts.

## Portable application setup

From your clone's root, use Node **24.x** and pnpm **11.19.0**. The verified local
runtime is Node **24.22.0**. Install/select Node through your normal trusted toolchain;
if pnpm is unavailable, install the pinned version with `npm install --global pnpm@11.19.0`.

```sh
node -v                 # v24.x; local verification: v24.22.0
pnpm -v                 # 11.19.0
pnpm install --frozen-lockfile
pnpm dev                # http://localhost:3000
```

Machine-local PATH configuration, launchers and Python/model caches are not included in
Git. The owner's existing shell setup selects the retained runtime in a fresh interactive
terminal; noninteractive shells must explicitly select Node 24. A fresh clone must supply
its own runtime rather than depend on ignored `.local/bin/` tools.

## Private local material

All paths below are relative to the repository and optional machine-local state:

| Path | Purpose |
| --- | --- |
| `.local/datasets/` | Local working datasets; academic originals remain outside this repository |
| `.local/datasets/evaluation-only/` | Ground truth, excluded from model prompts |
| `.local/evidence/`, `.local/workspace/` | Private execution evidence and workspace receipts |
| `.local/reviews/` | Temporary reviewer deliverables, not source backups |
| `.local/toolchains/`, `.local/bin/`, `.local/tools/` | Optional owner-local runtimes and launchers; not fresh-clone prerequisites |
| `.venv-ai/` | Optional Python 3.12 Docling/RapidOCR environment |
| `.ai-local/` | Private runs/quota ledger; never reset to obtain extra requests |

`.local/` is excluded from Git, ESLint, TypeScript and production tracing. Keep unique
local evidence and protected recovery objects private. Published Git history is the
source backup; it does not replace private evidence or protected recovery objects.
Never commit credentials, local quota state, recovery metadata or private datasets.

## Offline AI demonstration and tests

CSV/XLSX use the existing TypeScript readers. PDF (digital/scanned), PNG and JPEG require
the pinned Python dependencies in `requirements-ai.in` / `requirements-ai-lock.txt`
and an approved, pre-provisioned Docling/RapidOCR model cache. See
[the current runtime guidance](../handoff/CURRENT.md#local-runtime-and-provider-boundary).
Do not install missing models or dispatch inference without the applicable authorization.

On an already configured POSIX machine, this starts the local experiment with provider
dispatch disabled and model downloads blocked. Ensure no provider credentials are loaded;
leave provider authorization flags disabled. The owner-local offline launcher additionally
unsets provider credentials and selects its existing interpreter/cache.

```sh
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED=0 \
FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED=0 FINGENCE_AI_LIVE_APPROVED=0 \
pnpm ai:demo             # http://127.0.0.1:3103/ai-ingestion

# Optional local synthetic workbook; set this to your own verified working copy.
FINSIGHT_WORKBOOK_PATH='/path/to/verified-synthetic-workbook.xlsx' \
pnpm test --maxWorkers=1

pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm build
```

The workbook and OCR checks are optional in an unconfigured clone; report actual skips.
Use serial workers for configured OCR checks on a 16 GB machine and keep model downloads
disabled during evaluation. Developer replay remains separately labelled `RECORDED_TEST`.
A simple upload does not authorize inference.

C1/C2 financial meanings remain unchanged. V2 pages/APIs remain denied in production even
with local flags set. Production traces must exclude `.local/`, private state, Python
environments and evaluation labels. Verify the locally running production build with
`scripts/verify-ai-production-isolation.mjs`; see that script for optional nonsecret
artifact-canary verification.

The standalone Node ESM large-workbook failure, dependency advisories, unverified Windows
execution and missing V2-to-C1 bridge remain separate issues. The configured Vitest workbook
check is not a standalone-runtime fix. Consolidation does not authorize provider dispatch,
production deployment or hosted database changes. Publication follows the owner's explicit
task scope; merging to a production branch is a separate release action.

Historical verification reports retain their original paths and outcomes. Private local
workspace receipts record physical relocation without rewriting historical evidence.
