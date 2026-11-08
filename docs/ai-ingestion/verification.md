# Executed verification — 20 October 2026

Isolated branch `feature/v2-multimodal-ingestion`, base `da10e2f21add1fec5449ac32ea1affdd8024563b`. No commit, push, deployment, main-branch edit or hosted database change. Node **24.22.0**, pnpm **11.19.0**, Python **3.12.14**, macOS arm64. Source, fixture and model hashes are retained with this increment. Environment/model caches and local logs are excluded from Git.

## Actual final commands

| Command | Actual result | Exit |
|---|---|---:|
| `pnpm install --frozen-lockfile` | Lockfile installation succeeded | 0 |
| `pnpm test` | **452 passed, 9 skipped (461)**; 34 files passed, 2 files skipped | 0 |
| `pnpm lint` | Passed, no reported warnings/errors | 0 |
| `pnpm typecheck` | `next typegen` and `tsc --noEmit --incremental false` passed | 0 |
| `pnpm check:server-boundary` | Existing server guard/import checks passed; new provider/service also retain `server-only` guards | 0 |
| `pnpm build` | Next.js 16.3.6 production build passed, including `/ai-ingestion` and `/api/ai-ingestion` | 0 |
| `pnpm audit --json` | **0 critical, 6 high, 5 moderate, 1 low** | 1 |
| `.venv-ai/bin/python -m pip check` | No broken requirements | 0 |
| `pnpm ai:benchmark` | 12 file/engine pairs, three actual local extractions each; no extractor failures | 0 |
| `pnpm ai:evaluate` | 10 cases, real extraction, **NOT_EXECUTED** live inference, 0 accepted | 0 |
| `pnpm ai:evaluate --recorded-test` | 10 cases, explicitly recorded test proposals, real verifier/financial functions | 0 |
| `pnpm ai:doctor` | Credentials false; live activation false; requests/tokens/reserved/estimated cost all zero | 0 |
| `git diff --check` | Passed | 0 |

The nine skips are the eight existing native PostgreSQL tests requiring unavailable `initdb.exe`/`pg_ctl.exe`, and the optional 6,000-row workbook test whose environment variable was not supplied. They are **not** claimed as executed. Existing disposable local database tests did execute in the full suite. No hosted database or real client data was tested. The new extraction suite actually ran with the installed Python environment; it was not skipped here. It will explicitly skip when that environment is absent.

There are **40 new V2 tests** across six suites. Coverage includes every critical field's exact row/column placement, independent dates, leading zeros/large exact decimals, allowed declarative operations, omitted rows/cells, cross-row citations, debit/credit reversal, numeric-ID/amount swaps, unreadable evidence, partial conversions, unknown headings, no input mutation, fresh-instance template binding, missing credentials and mocked provider safety gates. No existing test files were edited.

## Review and defects actually reproduced

The semantic-swap and omitted-populated-cell regressions first failed against the original verifier: **2 failed, 8 passed**. They exposed a real acceptance defect despite exact citations. After repair, the new source-role/coverage/monetary-policy gates block those proposals. A fresh-context bounded review rechecked both that defect and incomplete PDF conversion; it reported both P1 findings closed, then executed **21 focused tests passed** plus the Python completeness checks. The independent reviewer did not perform live inference.

The build initially failed because Turbopack traced an out-of-root Python interpreter symlink. The worker is now an explicit external local runtime supplied by the demo/CLI; the final production build succeeds without bundling a virtual environment. Browser rehearsal also identified Next's internal `localhost` versus actual `127.0.0.1` origin mismatch. A same-port loopback Host check and regression now preserve valid local requests while rejecting cross-origin/production requests. These failures are documented rather than presented as initial passes.

## Extraction and recorded verification

[Measured benchmark](../research/extraction-benchmark.json): Docling recovered **96/96 exact position-associated fields and 16/16 rows** across the five positive PDF/image representations. The lightweight comparator recovered **36/96 position-associated fields and 6/16 rows**. Both found the 96 expected strings globally, showing why text presence must not be described as table accuracy. Neither extracted a structured table from the low-quality image. This is a tiny synthetic-layout study, not evidence of general document accuracy or financial LLM accuracy.

[Evaluation summary](evidence/evaluation-summary.json): seven positive recorded-test representations yield **24 WARNING test records**, each with the existing `MISSING_REFERENCE` issue; ambiguous CSV, prompt-like CSV and unreadable image yield zero accepted records and need review. These are repeated versions of the same underlying four transactions, **not 24 unique transactions**. Test proposals are hand-authored. No live model output, token measurement or model-quality claim is inferred from them. The actual no-credentials evaluation accepts zero records across all ten cases.

## Browser execution

Actual Chromium rehearsal at **1440 × 1000**: uploaded CSV, XLSX, digital PDF, scanned PDF, mixed PDF, PNG, JPEG and unreadable PNG; processed every file; observed real extraction and separately blocked live inference; downloaded eight evidence reports and parsed their format/hash/coverage/inference/accepted contents. All reported zero accepted records without credentials. Final rehearsal recorded **zero unexpected console/page errors** and no horizontal page overflow. Earlier failed origin attempts are not counted as successful runs.

The final local launcher was restarted after the worker-runtime correction. Scanned PDF processing succeeded again. At **768, 390 and 320 px**, the upload input and evidence download remained visible without horizontal page overflow. Native disclosures and keyboard Tab were exercised; this is practical inspection, not a complete accessibility audit. [Desktop evidence](evidence/desktop-scanned-pdf.png), [mobile evidence](evidence/mobile-scanned-pdf.png), [desktop cases](evidence/browser-desktop.json), [responsive cases](evidence/browser-responsive.json).

Actual HTTP boundary checks: production-mode local server `/api/ai-ingestion` **403**; a foreign Origin against the local demo **403**; unregistered bytes **422**. The production-mode check used a local `next start`, not Vercel. No production configuration changed.

## Dependencies and preservation

Only new direct Node dependencies are OpenAI 7.39.0 and Zod 4.6.7. The latter also updates the existing compatible transitive ESLint Zod resolution from 4.5.4. Next/React/financial-parser and other existing package versions are unchanged. The audit reports advisories on the existing locked `brace-expansion`, `braces`, `source-map-js`, optional `sharp` and Next paths. This is a nonzero backlog, not a clean security assessment. No broad audit fixes were attempted. `pip check` is dependency-consistency verification, **not a Python vulnerability scan**; a full Python/native/model security audit remains outstanding.

[Preservation evidence](evidence/preservation.json) verifies empty diffs for protected ingestion/UI/fixture/test paths; exact C3-I0 fixture hashes; clean original personal/team worktrees at their existing commits; protected stash `1aa97d83500cab7055d1d8dda0b3fe727ae11556`; and all three external sample backup hashes matching their original manifest. No stash was applied or dropped. The isolated main worktree remains clean at the base. No historical tag was changed.

## Credential and completion boundary

The proposed destination was checked as the correct isolated checkout, Git-ignored, absent and not a symlink. Owner-only `600` creation was required by the secure setup request. **Confirmation was declined again before creation/writing**, so no credential file or key was produced. There is no existing key to overwrite, expose, rotate or publish.

No real OpenAI inference occurred: **0 requests, 0 input tokens, 0 output tokens, US$0 estimated spend, US$0 reserved**. The intended model is `gpt-6.1-sol`; actual account access, real API compatibility, provider-side project/billing controls and live semantic accuracy remain unverified. The application budget tests reserve only in temporary test directories or use a mocked SDK; they incur no API spend.

This increment completes the authorized non-inference implementation and local extraction/verifier demonstration. It does **not** complete the live LLM evaluation, general financial-policy resolution, production upload security or V2-to-C1 integration. FinGence 1.0 production and both main branches were not modified.
