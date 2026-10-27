# Consolidated local workspace

26 October 2026. Root: `~/Documents/FinGence`.

- Current personal repository: `repositories/FinGence`; preserved main `da10e2f`.
- Active V2 worktree: `worktrees/FinGence-2.0-AI-Ingestion`; branch `feature/v2-multimodal-ingestion`, with all uncommitted Increments 01–03 preserved.
- Historical checkpoint repository: `repositories/FinGence-legacy`; its protected stash is never applied or dropped.
- Historical linked worktree: `worktrees/finsight-team-integration`.
- Historical shared release: `repositories/FYP-A-B-historical`.
- School-original workbook remains in School; verified development input: `datasets/originals/Datasets.xlsx`.
- Technical records/reviews/snapshots belong under the central root. Do not generate permanent development artifacts in Developer or Downloads.

Read the root `README.md` and `migration/2026-10-26/MIGRATION_REPORT.md` for actual verification and limitations. Dataset research, Groq readiness, Windows and separate security-maintenance instructions are under the root `docs/`. Historical execution documents and submitted academic material are not rewritten.

From the V2 worktree, use the pinned Node 24 toolchain at `../../tools/saic-node-toolchain/node-v24.22.0-darwin-arm64/bin`, project pnpm 11.19.0 and the recreated `.venv-ai`. `pnpm-workspace.yaml` is ignored by Git but intentionally preserved; it contains build-script policy needed for reproducible installation.

Use `FINSIGHT_WORKBOOK_PATH='../../datasets/originals/Datasets.xlsx' pnpm test --maxWorkers=1` for serial tests including the 6,000-row workbook. On this 16 GB Mac, do not run multiple OCR evaluations concurrently. Existing Python/model caches are reused; never download missing weights silently.

For local development without inference authorization, keep `FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED=0` and `FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED=0`. The `tools/ai-python-offline` executable forces offline Hugging Face settings when passed as the extraction interpreter. The normal Increment 03 launcher selects the recreated interpreter directly; use the central no-inference launcher for the verified offline configuration.

No credential setup, live inference, V2-to-C1 cast, backend integration, production change, commit or publication is authorized by the consolidation. Original directories remain intact until separate deletion approval. Frozen archives and historical reports retain their original paths as evidence; use this document for current operational paths.

## Feature checkpoint publication — 26 October 2026

The owner has now authorized publication of the V2 feature checkpoint and synchronization with S4 main. This supersedes the consolidation-only publication restriction above, while production and inference remain separately controlled. See [current checkpoint and secure inference boundary](publication-2026-10-26.md). Existing local main remains intentionally preserved; remote production main is bb283c1.
