# PoC v0.1 verification evidence

## A3 reader and dependency hardening — 2 October 2026

**PARTIALLY IMPLEMENTED; DEPENDENCY REMEDIATION BLOCKED.** The byte-view boundary, direct Node consumption and Next.js patch are verified. Normal compatible pnpm resolution still retains `brace-expansion@5.0.9`; the full audit remains **1 moderate, 2 high, 0 critical**. A3 has not met its clean-audit target, and B1/B2 finance UX remains deferred. Work is uncommitted on `feature/data-ingestion`. The A1/A2 and September sections below are dated historical evidence, including their earlier reader limitation and audit results; use this section for the current A3 status.

### Reader change and regression evidence

`inspectFile()` now uses `Uint8Array.from(input)` rather than the polymorphic `input.slice()`. Hashing, CSV decoding, workbook inspection and XLSX parsing share one owned copy containing exactly the supplied view. The public API, bounds, error handling, financial conventions and schema/ruleset versions remain unchanged. Node callers can pass `readFileSync()` output directly; the handoff fixture loader does so, and the two orientation documents no longer prescribe a caller-side Buffer copy.

The four new [reader tests](../../tests/ingestion/readers-buffer.test.ts) pass padded, nonzero-offset Buffer and ordinary Uint8Array views of CSV and XLSX content. The CSV Buffer explicitly uses a larger pooled backing allocation. Independent Node SHA-256 hashes cover the source and supplied view; assertions also cover exact byte counts, CSV string identifiers/values and row coordinates, workbook sheet names/rows/typed cells, and unchanged caller storage.

| Exact focused command / implementation | Actual outcome |
| --- | --- |
| `pnpm test tests/ingestion/readers-buffer.test.ts` against the old reader | **2 failed, 2 passed (4)**; exit 1. Buffer CSV hashed bytes outside the view; Buffer XLSX raised `WORKBOOK_CONTENT`. Both ordinary Uint8Array controls passed. |
| `pnpm test tests/ingestion/readers-buffer.test.ts tests/ingestion/handoff.test.ts` after the fix | **2 test files passed; 17 tests passed (17)**; exit 0. All four reader cases and all 13 handoff cases passed. |

Handoff assertions still establish **26 processed, 23 accepted/visited = 20 VALID + 3 WARNING, 0 REJECTED visited**, version preflight before any callback, complete warning/source lineage, exact decimal and identifier strings, separate dates and monetary representations, and same-dataset replacement. The checked synthetic evidence JSON was not regenerated and remains byte-identical to the A1/A2 baseline (SHA-256 `2d3b2dfdbf2b8a215bb42d774e31ac813ec606f4ce164510ff2879400efa5cf6`).

### Dependency outcome and remaining blocker

| Package | Before A3 | Installed after A3 | Approved target |
| --- | --- | --- | --- |
| `next` | 16.3.3 | **16.3.6** | 16.3.6 |
| `eslint-config-next` | 16.3.3 | **16.3.6** | 16.3.6 |
| `brace-expansion`, 1.x | 1.1.18 | **1.1.21** | 1.1.21 |
| `brace-expansion`, 5.x | 5.0.9 | **5.0.9 — unresolved** | 5.0.12 |

Only the two Next.js root pins, their necessary `@next/env`, ESLint plugin and SWC companions, and the compatible brace-expansion 1.x patch changed. The active dependency ancestry was checked with `pnpm why next eslint-config-next brace-expansion`, not merely by looking for version strings in the lockfile. All other installed package versions and existing package-manager/build-script policies are preserved.

Normal operations were inspected with manifest/lockfile diffs, dependency ancestry and a full audit after each operation:

- `pnpm update next@16.3.6 eslint-config-next@16.3.6 --depth 0`: exit 0; Next family patched; audit reduced from seven findings to six, with no critical finding.
- `pnpm update brace-expansion --depth Infinity --no-save`: exit 0; only the 1.x path moved to 1.1.21; three 5.x findings remained.
- `pnpm audit --fix=update`: exit 1; reported **0 vulnerabilities fixed, 3 remain**. Its incidental root-range narrowing and release-age exclusion were reverted; no overrides or policy exceptions remain.
- `pnpm update brace-expansion --depth 100 --no-save` and `pnpm update minimatch brace-expansion --depth Infinity --no-save`: each exit 0, but the surviving 5.x path stayed at 5.0.9.
- An attempted `--prefer-online` diagnostic was rejected by pnpm 11.19.0 as an unknown option before making changes.

The unresolved active path is:

```text
eslint-config-next@16.3.6
  → typescript-eslint@8.68.0
  → @typescript-eslint/typescript-estree@8.68.0
  → minimatch@10.2.6
  → brace-expansion@5.0.9
```

`minimatch@10.2.6` declares `brace-expansion: ^5.0.8`, so the published target 5.0.12 fits its parent range. The observed blocker is that normal pnpm resolution retains 5.0.9; the underlying resolver reason was not established. Do not misread this as a semver incompatibility or an unpublished target. Dependency edits stopped at this point as instructed; no forced resolution, override, unrelated upgrade or cross-major change was applied.

The final full audit, including development dependencies, contains these three entries, all against 5.0.9:

| Advisory | Severity | Patched floor for the 5.x path |
| --- | --- | --- |
| [Quadratic expansion, GHSA-q2hr-2g5m-vwhr](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr) | Moderate | 5.0.12 |
| [Nested-group recursion, GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | High | 5.0.11 |
| [Comma-part recursion, GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | High | 5.0.10 |

The [Next.js ImageResponse finding](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) and all three 1.x brace findings no longer appear. No application import of `next/og`, `ImageResponse`, `minimatch` or `brace-expansion` was found. The brace paths enter through development lint tooling. A fresh read-only candidate review confirmed a package-level recursion exception remains reachable through installed minimatch, and found no byte-view bypass/regression. These observations do not establish a remotely exploitable application route or a complete security assessment.

### Working-repository verification

Environment: Node **v25.8.1**, pnpm **11.19.0**, Next.js **16.3.6**, Vitest **4.1.11**.

| Exact command | Actual outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 216ms using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **8 test files passed, 1 skipped (9); 98 tests passed, 1 skipped (99)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 |
| `pnpm build` | Compiled successfully; TypeScript completed; **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **0 info, 0 low, 1 moderate, 2 high, 0 critical**; three unresolved 5.x entries; exit 1 |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **9 test files passed (9); 99 tests passed (99)**; exit 0; includes the 6,000-row workbook |
| `pnpm why next eslint-config-next brace-expansion` | Next/config 16.3.6, brace 1.1.21 and 5.0.9 in the active tree; exit 0 |
| `git diff --check` | No whitespace errors; exit 0 |

### Manual production-build smoke check

`pnpm start --hostname 127.0.0.1 --port 3172` started Next.js 16.3.6 locally (`Ready in 108ms`). The temporary server was stopped after verification. No deployment occurred.

The in-app browser exercised reset and actual file-picker uploads of all three synthetic fixtures. Ledger profiling showed 10 rows / 7 columns; review/approval/validation produced 10 VALID. The bank workbook required choosing Transactions (8 rows / 7 columns) and correcting Details → reference before approval; it produced 8 VALID. Edge-case validation produced 2 VALID, 3 WARNING and 3 REJECTED. The rejected filter and source-row-7 inspector showed the original `31/31/2026`, `INVALID_DATE`, raw cells, partial candidate and file/hash/row/batch/UTC provenance. The canonical table and summary showed **26 received, 23 accepted, 20 VALID, 3 WARNING, 3 REJECTED**, success **88.46%**, clean validity **76.92%** and required-value completeness **96.15%**.

Reloading ledger displayed the duplicate-file warning and kept 23 accepted records. Changing its journal mapping removed its old 10-row result (13 accepted remained), cleared approval and disabled validation. Restoring, approving and reprocessing returned to 23 records. These were visible UI actions; no engine/page state was injected.

The in-app browser's download-event capture timed out. A separate native Edge test tab repeated the three-sample mapping/approval flow and successfully downloaded the three exports. Actual downloaded bytes were independently inspected:

| Download | Actual outcome |
| --- | --- |
| `canonical-transactions.csv` | **9,701 bytes; 23 rows = 20 VALID + 3 WARNING; no REJECTED rows** |
| `rejected-issues.csv` | **1,438 bytes; 4 issue lines** for the 3 rejected records |
| `ingestion-evidence.json` | **127,504 bytes; 3 datasets, 26 processed records, 23 normalized records**, statuses match the summary |

The temporary browser tabs were closed. This is a local synthetic smoke check, not a cross-browser certification or an automated UI suite.

### Scope and review packaging

Before-edit source/configuration hashes separate A3 from the pre-existing uncommitted PoC and A1/A2. Only the reader, new four-case reader regression file, handoff fixture adapter, two handoff Node paragraphs, package manifest/lockfile and this verification note change in A3; the four review snapshots are refreshed for packaging. Financial models, mapping/validation/normalization/pipeline logic, UI, canonical/schema/ruleset versions, dependencies outside the necessary patch paths, synthetic evidence JSON, README/AGENTS/CLAUDE and formal university documents are preserved. Local CodeGraph indexes and OS metadata are excluded from the review package.

The new `finsight-a3-review.zip` is a **review snapshot with a documented dependency blocker**, not a clean-audit release. The historical `finsight-handoff-review.zip` is retained unchanged (SHA-256 `35668817fd3e8b273803f26a9749dc16cf6a53442a373be1f0344b5d5ce80544`). The A3 archive includes the current source/configuration, full ingestion tests/fixtures, handoffs/examples, four fresh Git snapshots and the supplied explicitly synthetic workbook at `_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx`. Ordinary Git diff omits untracked files; the ZIP provides those files for review. No client data, formal assignments, environment files, dependencies, Git internals, build caches, logs or deployment metadata belong in the archive.

### Clean-extraction verification

A candidate A3 ZIP was extracted into a new temporary source directory with no `node_modules`, `.next`, `.git`, `.vercel` or environment files copied. Installation used the existing machine's pnpm content-addressable cache normally; this is a clean source/dependency directory, not a new machine or an empty global cache.

| Exact command in extracted `finsight-prototype/` | Actual outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile current; **397 packages installed**; `Done in 2.5s using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **8 test files passed, 1 skipped (9); 98 tests passed, 1 skipped (99)**; exit 0 |
| `FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **9 test files passed (9); 99 tests passed (99)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 |
| `pnpm build` | Compiled successfully in 2.4s; TypeScript completed; **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **0 info, 0 low, 1 moderate, 2 high, 0 critical**; the same three unresolved 5.x entries; exit 1 |

Installed package manifests and actual minimatch resolution independently confirm Next/config **16.3.6**, minimatch 3.1.5 (`^1.1.7`) → brace **1.1.21**, and minimatch 10.2.6 (`^5.0.8`) → brace **5.0.9**. The clean frozen installation therefore reproduces both the successful patches and the unresolved path; it does not silently repair the audit.

All **79 packaged input files** remained byte-identical after installation, type generation and build. The final archive is refreshed only with this executed-verification note and fresh Git metadata. Its executable source, configuration, tests, synthetic fixtures and authentic evidence JSON remain identical to the tested extraction. Final CRC, manifest, required-entry and exclusion checks confirm that equivalence.

Archive checks: **79 regular file entries**, a single `finsight-prototype/` root, CRC integrity passed, required entries present, no unsafe paths/symlinks or excluded directories/files, and no matches for the checked private-key/token/literal-credential patterns. These are bounded packaging checks, not a guarantee that a scanner detects every secret or that the dependency audit passed. Only the controlled fixtures and explicitly labelled synthetic supplied workbook are financial inputs. The historical A1/A2 archive remains unchanged.

No commit, push, deployment, upload or B1/B2 work was performed. Resolve the documented 5.x dependency blocker through a separately reviewed normal compatible approach before treating A3 as fully clean.

---

## A1/A2 handoff increment — 2 October 2026

Implemented only the teammate/AI orientation entry points, React-independent consumer recipe, regression tests and generated synthetic export. B1/B2 finance UX, JSON Schema, backend/AI/dashboard integration and engine/dependency changes remain deferred. Work remains uncommitted on `feature/data-ingestion`; the availability statement in the handoffs describes this local checkout, not an already published branch.

The 29 September section below is historical evidence of the correctness follow-up. Its zero-advisory audit result does **not** describe today's dependency audit.

### Working-repository checks

| Exact command | Actual outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 259ms using pnpm v11.19.0`; exit 0 |
| `FINSIGHT_REGENERATE_HANDOFF_EXAMPLE=1 pnpm test tests/ingestion/handoff.test.ts` | **1 test file passed; 13 tests passed (13)**; generated the checked example; exit 0 |
| `pnpm test` | **7 test files passed, 1 skipped; 94 tests passed, 1 skipped (95)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics on the final run; exit 0 |
| `pnpm build` | Compiled successfully; TypeScript completed; **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **2 moderate, 4 high, 1 critical** (7 advisory entries); info/low 0; exit 1 |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **8 test files passed; 95 tests passed (95)**; exit 0 |
| `git diff --check` | No whitespace errors; exit 0 |

Environment remains Node **v25.8.1**, pnpm **11.19.0**, Next.js **16.3.3**, Vitest **4.1.11**. The baseline before A1/A2 was **81 passed, 1 skipped (82)**. The first test run failed because the new consumer did not yet exist. The first ordinary example check then exposed pooled-Buffer fingerprint instability; it passed after correcting the new Node fixture adapter and regenerating authentic evidence. The first standalone type check encountered duplicate generated `.next/types/routes.d 2.ts` and `cache-life.d 2.ts`; the production build regenerated those cache files, and type generation plus standalone checking then passed. No source/configuration change was needed for that cache issue.

### Handoff behavior and review

The 13 new tests independently inspect visited IDs and statuses: **26 processed, 23 accepted/visited = 20 VALID + 3 WARNING, 0 REJECTED visited**. They also check schema/ruleset incompatibility before **any** callback (including replaced results), complete warning/source lineage, exact large decimal strings and leading-zero identifiers, distinct source dates and explicit canonical date/basis, normalized UTC provenance, source monetary representations, empty input and same-dataset replacement. The example performs no financial totals, network calls or persistence.

Temporary deliberately incorrect consumers were tested outside the repository using the existing Vitest CLI and dependencies; these are fault checks, not clean-environment verification:

| Incorrect variant | Actual targeted result |
| --- | --- |
| Validate and visit each result before checking later results | **4 failed, 2 passed, 7 unselected/skipped**; failures detected 10 prior callbacks |
| Check versions only after consolidation replaces earlier results | **2 failed, 4 passed, 7 unselected/skipped**; failures detected 10 callbacks instead of rejection |
| Forward every processed candidate including quarantine | **1 failed, 12 unselected/skipped**; observed 26 visits where 23 were required |

**SYNTHETIC EXAMPLE · NOT CLIENT DATA · NOT A PRODUCTION API CONTRACT:** [generated evidence JSON](../handoff/examples/ingestion-evidence.json) comes from the three existing controlled fixtures through the real public reader/mapping/pipeline/exporter, with the documented bank correction, batch ID `synthetic-handoff-example-batch-001` and fixed UTC timestamp. It is the authentic exporter output plus a final newline, with no fabricated labels/fields or repurposed lineage IDs. Ordinary tests compare its full bytes and separately assert fixture counts, dates, exact monetary values, mapping approval, rates and quarantine coordinates.

Node adapters must pass owned bytes (`new Uint8Array(readFileSync(path))`) rather than pooled Buffer views to the current reader. Independent Node SHA-256 assertions and a separate file-byte comparison verify all three example fingerprints and canonical lineage. Browser input already uses owned bytes. Direct pooled-Buffer support is an existing reader limitation; engine hardening is deferred rather than expanding this increment.

Source review covered correctness, readability, module boundaries, security and performance. Before-edit SHA-256 snapshots distinguish this increment from the existing uncommitted PoC: **66 protected original source/config/fixture files remain unchanged**. Only README, AGENTS, architecture and this verification document change among original files; five new handoff/example/test files are added. The managed Next.js AGENTS block, CLAUDE file, dependency/lock/config files, ingestion engine, UI, older tests/fixtures and other pages are preserved. Relative file links and the new source/diff were inspected. No UI interactions were repeated in A1/A2; the earlier manual consultation checks below remain historical evidence.

### Current dependency audit limitation

The seven advisory entries are from unchanged dependencies: six development-tool entries for `brace-expansion` **1.1.18 / 5.0.9**, covering [quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [nested-group recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and [comma-part recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p); plus the critical [Next.js `next/og` ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) against **16.3.3**. No `next/og` / `ImageResponse` use was found in application, component, library or example source. This is a package-version finding, not proof of an exploitable application path or a complete security assessment. Dependency remediation requires a separately authorized increment; no audit fixes or upgrades were applied here.

### Independent review package

The local review archive uses a `finsight-prototype/` root and includes source/configuration, the public ingestion API/engine, the complete existing ingestion test suite, synthetic fixtures, handoff/example material and four fresh `REVIEW_GIT_*` snapshots. Ordinary Git diff omits untracked files; those files are supplied as archive entries. Review metadata is intentionally uncommitted. The supplied workbook's README explicitly identifies synthetic test data only; it is included **inside the ZIP only** at `_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx`, without copying it into the working repository.

From an extracted archive, the optional workbook command is:

```bash
FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test
```

Dependencies, Git internals, build caches/outputs, environment files, logs, private keys, deployment metadata, unrelated artifacts and formal course assignments are excluded by an explicit allowlist. The broader application source is included for context/building; other FinSight pages remain mock-driven.

### Fresh-extraction verification

A candidate ZIP was extracted into a new temporary directory with no `.git`, `node_modules`, `.next` or environment files copied. Installation used the machine's pnpm content-addressable cache normally; this is a clean source/dependency directory, not a new machine or an empty package cache.

| Exact command in extracted `finsight-prototype/` | Actual outcome |
| --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile current; **397 packages installed**; `Done in 13.1s using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **7 test files passed, 1 skipped; 94 tests passed, 1 skipped (95)**; exit 0 |
| `FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **8 test files passed; 95 tests passed (95)**; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 |
| `pnpm build` | Compiled successfully; TypeScript completed; **11/11 static pages generated**; exit 0 |
| `pnpm start --hostname 127.0.0.1 --port 3170` | Local server started; `/data` and all three public fixture routes **HTTP 200**; sample response bytes matched fixture hashes; server stopped |

All **78 packaged input files** remained byte-identical after install/type generation/build. The final archive is refreshed only with this verification note, README's corrected local-fixture wording and fresh Git metadata; executable source, configuration, tests, synthetic fixtures and generated evidence remain identical to the tested extraction. A final manifest comparison and archive integrity/exclusion scan verify that equivalence. No UI click-through was repeated; the startup smoke check does not replace the historical consultation flow below.

Archive checks: **78 regular file entries**, a single `finsight-prototype/` root, CRC integrity passed, required entries present, no unsafe paths/symlinks or excluded directories/files, and no matches in the included material for the checked private-key/token/literal-credential patterns. These are bounded packaging checks, not a guarantee that a scanner detects every secret or that the dependency audit passed. Only the controlled fixtures and explicitly labelled synthetic supplied workbook are included as financial input. No upload, commit, push or deployment was performed.


---

## Targeted correctness follow-up — 29 September 2026

Verified locally with **Node v25.8.1**, **pnpm 11.19.0**, Next.js 16.3.3 and Vitest 4.1.11. Work remains uncommitted on `feature/data-ingestion`; no push or deployment was performed. These checks use synthetic sources and do not establish client acceptance, accounting accuracy, reconciliation accuracy or model performance.

Inspection used Git status/diff/log, the existing contract/date handling, tests/docs and CodeGraph dependencies. The saved review patch exactly matched the tracked diff at entry, with no new commits visible. The four review-only files were removed. A temporary snapshot of the existing PoC was used to distinguish this follow-up from its earlier uncommitted implementation. Dependency manifests, the Data page orchestration, reader/mapping/business-policy modules and unrelated features were unchanged by this follow-up.

## Automated checks

| Exact command | Actual outcome |
| --- | --- |
| `node --version` | `v25.8.1` |
| `pnpm --version` | `11.19.0` |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 216ms using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **6 test files passed, 1 skipped; 81 tests passed, 1 skipped (82)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 |
| `pnpm build` | Compiled successfully; TypeScript completed; **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | No advisories; info/low/moderate/high/critical vulnerabilities all **0**; exit 0 |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **7 test files passed; 82 tests passed (82)**; exit 0 |
| `git diff --check` | No whitespace errors; exit 0 |

The baseline suite passed **48 tests with 1 skipped** before edits. The first 30 new regression cases were run against the original implementation: **25 failed, 5 passed**. The differing-date posting-basis case specifically observed the incorrect overwrite of transaction date `2026-09-01` with posting date `2026-09-03`. Expected values were chosen independently from the source dates and selected basis.

The final suite adds **32 contract regressions** plus **1 provenance export test** and strengthens existing pipeline/export/golden checks. Date coverage includes both distinct-date selections, sole usable selected dates, missing/invalid selected inputs with a usable alternative, an unmapped selected date, and invalid optional dates. Timestamp coverage includes UTC with/without milliseconds, positive/negative offsets and date crossing; it rejects locale/date-only/timezone-less input, invalid calendars/times/offsets, unsupported precision, unknown offsets and out-of-range UTC years. Provenance tests cover source/default/absent currency and either blank ledger side converted under explicit approval. CSV and JSON tests verify the same contract across exports without losing raw evidence.

Existing tests continue covering CSV/XLSX inspection, typed values and exact decimals, coordinates/quoting, profiling, deterministic mapping/overrides/approval, business policies, completeness, traceability, duplicates/reprocessing, safe exports and independent fixture outcomes. Defensive workbook tests cover representative unsupported/unsafe constructs; they are not a comprehensive hostile-workbook guarantee.

The optional workbook check verifies **6,000 received and accepted**, no rejections, 4,148 DEBIT and 1,852 CREDIT sides, preserved positive source amounts and final source row 6,001. Label/ground-truth sheets are not input transactions. This external synthetic workbook was not copied into Git.

## Startup verification

The existing local development server served `/data` with HTTP 200 and was used for manual checks. The current production build was started with:

```bash
pnpm start --hostname 127.0.0.1 --port 3100
```

It reported `Ready in 133ms`. A Node HTTP smoke check returned **200** for `/data` and all three `/samples/ingestion/` fixture paths; the page contained the PoC title and updated `Canonical date / basis` header. The temporary production server was stopped after these checks.

The initial implementation's 28 September verification also tested an empty temporary project copy with no `.next`, `node_modules`, `.env` or uploaded records copied. That fresh-copy install/build/startup check was not repeated for this follow-up; dependency files are unchanged. Current install/build/type checks were run in the working repository. Other operating systems and Node versions are not verified.

## Manual consultation flow

The in-app browser exercised reset; ledger CSV profile/review/approval/validation; bank XLSX selection of Transactions; Details → reference manual correction/approval/validation; edge-case profiling/validation; VALID/WARNING/REJECTED filters; rejected-row inspection; canonical provenance and consolidation; summary; duplicate file protection; mapping invalidation; restoration/reprocessing; and reset. The final three-fixture session was rebuilt and retained for consultation. No engine state or records were injected into the page.

Native Edge file selection independently uploaded both the ledger CSV and bank XLSX. Profiles showed **10 rows / 7 columns** and **8 rows / 7 columns** respectively. The bank required worksheet selection and manual mapping correction before approval. Edge then loaded and validated the edge-case sample in the same session and downloaded all three exports.

Observed totals matched `expected.json`: **26 received = 20 VALID + 3 WARNING + 3 REJECTED**, **23 accepted**. Success **88.46%**, clean validity **76.92%**, required-value completeness **96.15%**. Duplicate/missing-date/missing-money/missing-reference/ignored-column counts were each 1. Completeness measures presence, including malformed populated values; it is not accuracy.

Rejected source row 7 retained original `"31/31/2026"`, `INVALID_DATE`, technical rejection, original cells/staging, hash/file/row/batch and a UTC ingestion timestamp. Its candidate had null transaction/posting/canonical dates and `TRANSACTION_DATE` basis. Canonical ledger rows now show null transaction date with retained posting date and explicit processing date/basis; bank rows retain source transaction date with null posting date.

Re-loading ledger kept **23 accepted**. Editing its journal mapping cleared approval, disabled processing and removed the old 10-row output (**13 remained**). Restoring and revalidating returned to **23**, rather than duplicating rows. Reset showed **0 files / 0 records**.

## Actual download checks

All three files were downloaded through Edge's visible export buttons. The following newly downloaded synthetic files were read with Node assertions and Papa Parse; older downloads were preserved:

| File | Actual check result |
| --- | --- |
| `canonical-transactions (1).csv` | **23 rows, 0 parser errors**; independent source dates, explicit canonical date/basis, UTC millisecond timestamps, currency basis and transformations verified; no legacy date-basis output field |
| `rejected-issues (1).csv` | **4 issue lines, 0 parser errors**; source rows **7/8/9** |
| `ingestion-evidence (1).json` | **3 datasets, 26 raw records, 23 canonical records**; normalized context/row timestamps and approved manual Details → reference mapping verified |

The in-app browser's download-event capture timed out, so actual download checks used native Edge. There is no automated UI suite or cross-browser/mobile certification. Currency-default/blank-side transformation records and the two-different-date case are covered by engine/export regressions; the public happy-path fixtures require neither defaults nor zero conversions.

## Review and data-handling boundaries

Code-review and security-hardening checklists informed the final scoped review. Application ingestion code has no upload POST/backend ingestion endpoint, external record transmission, persistent browser storage or record-level logging; its only fetch loads same-origin synthetic sample bytes. React renders source values as text. Filenames remain sanitized; unsupported files fail safely; spreadsheet-formula protection in CSV text remains covered by tests. No new credentials, client records, environment files or dependencies were introduced.

This is a code/control review and synthetic workflow verification, not a comprehensive browser/network/extension/OS privacy guarantee. Downloaded evidence deliberately persists locally and may be sensitive with real input. Workbook bounds/checks do not establish comprehensive hostile-file safety.

Screenshots were refreshed during this follow-up: [fixture summary](evidence/summary.png) and [quarantine inspection](evidence/quarantine.png). Both show synthetic input; the latter collapses the raw-row panel to expose the new date fields while retaining the original problematic value in the issue card. Batch IDs/timestamps vary on rerun.

Remaining limits are the existing browser-memory PoC boundaries: no persistent deduplication or original binary reconstruction, no economic reconciliation/currency conversion, structural currency validation only, no backend/auth/downstream integration, main-thread parsing within explicit limits, and provisional client-dependent conventions. The timestamp parser intentionally supports known-offset instants with at most millisecond precision, not every ISO 8601/RFC3339 variant. Transformation records cover approved blank-side zeros and currency origin, not every normalization operation.
