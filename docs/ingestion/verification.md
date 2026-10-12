# PoC v0.1 verification evidence

Entries are dated historical evidence. The **B1/B2 finance-user UX** section at the end records the current UX increment; earlier statements about deferral, branch state and audit results describe those earlier runs.

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


## B1/B2 finance-user UX — 2 October 2026

**IMPLEMENTED IN THE CURRENT WORKING TREE; AWAITING INDEPENDENT REVIEW.** Implementation began from a clean `feature/finance-ingestion-ux` checkout with HEAD equal to `ingestion-v0.1-baseline` (`ce3c65f77ef00d567eb11abe877b35a0ceaf1513`). The three pre-existing team-integration wording edits in README/TEAM_HANDOFF/AI_CONTEXT were restored as explicitly requested. No shared repository was used or changed. This increment changes only the Data-page presentation/UI state, a pure presentation helper and its tests, and the demo/verification documentation.

### Financial and contract boundaries

The new Ready / Included — needs attention / Cannot include labels represent the existing `VALID` / `WARNING` / `REJECTED` codes. The first two remain accepted; the third remains quarantined. The six numbered sections are one page, with explicit dataset review and unchanged checking eligibility. “Which date should be used for these records?” is dataset-scoped. Transaction and posting dates remain independently visible in row review, beside the explicitly selected canonical date/basis. Monetary modes, exact decimal strings, identifier strings, source-currency/default origin, approved blank-side changes and source file/worksheet/row remain visible without introducing inference, currency conversion or mixed-source financial totals.

Technical file/mapping/row evidence and detailed quality definitions use native disclosures. The original/staging/candidate, all issue codes/messages, IDs, hashes, batch/time, reviewed options and version context remain inspectable. Display previews are capped as before; exports keep full content. Warnings and rejected rows are shown first when they exist, using a display-only Needs review filter. On settings changes, the previous affected output is removed as before, with persistent explanation until reviewed and checked again. Unchecked choices still restart on file/sheet switches; checked dataset choices restore. No saved profiles or persistence were introduced.

Before/after SHA-256 comparison verified **39 protected files unchanged**: complete ingestion engine, all nine original tests, public fixtures, consumer example, handoffs and checked evidence JSON, README/AGENTS, dependencies/lockfile, shared UI/overlay/styles, architecture and test configuration. The checked synthetic evidence JSON retains SHA-256 `2d3b2dfdbf2b8a215bb42d774e31ac813ec606f4ce164510ff2879400efa5cf6`. Schema/ruleset remain `0.1`; these are provisional and still require team/client confirmation.

### New presentation regressions

[presentation.test.ts](../../tests/ingestion/presentation.test.ts) adds **14 test cases**, including two date-basis cases. They independently verify:

- The 26 fixture rows retain 20 VALID, 3 WARNING and 3 REJECTED statuses; 23 accepted IDs exclude every rejected ID. Needs review selects exactly the six warning/rejected rows in source order.
- Different source dates (1 and 3 September) retain both meanings under each canonical-date basis.
- The large signed decimal `-9007199254740993.1`, leading-zero reference/transaction/account identifiers, numeric zero, typed zero, whitespace and blank values retain their distinctions.
- Currency supplied by the file versus a reviewed MYR default, and original blank credit versus approved zero, are described from existing evidence.
- Ledger sides and bank amount/label representations remain separate; no financial total is created.
- Invalid dates, missing dates and whole-row duplicate issues are not conflated. Every issue survives; unknown rules preserve the engine message and a conservative action.
- The actual Details/Narration collision identifies both columns without altering authoritative errors. Source examples preserve leading zeros.
- Presentation calls leave engine results, lineage, issues, evidence JSON and canonical CSV unchanged; review states distinguish blocked/reviewed/checked/invalidated output.

No original engine/handoff tests were edited. No browser-test or DOM-emulation dependency was added. Interaction checks below are manual browser verification, not automated component/visual tests or a finance-staff usability study.

### Working-repository commands and actual results

Environment: Node **v25.8.1**, pnpm **11.19.0**, Next.js **16.3.6**, Vitest **4.1.11**.

| Exact command | Actual result / exit code |
| --- | --- |
| `pnpm test tests/ingestion/presentation.test.ts tests/ingestion/handoff.test.ts` | **2 files passed; 27 tests passed**; exit 0 (B1 checkpoint) |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 227ms using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **9 files passed, 1 skipped (10); 112 tests passed, 1 skipped (113)**; exit 0. Only the optional supplied-workbook case skipped. |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **10 files passed; 113 tests passed (113)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0. An earlier new JSX apostrophe diagnostic was corrected before this successful rerun. |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0, after type generation |
| `pnpm build` | Next.js 16.3.6; compiled successfully, type checking completed, **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **0 critical, 2 high, 1 moderate, 0 low, 0 informational**; exit 1. Matches known A3 development-tooling baseline; no dependency edits. |
| `git diff --check` | No whitespace errors; exit 0 |
| `pnpm start --hostname 127.0.0.1 --port 3180` | Production server started locally; Data-page interaction verified below. No deployment. |

The full audit still reports only `brace-expansion@5.0.9` through ESLint/TypeScript-eslint/minimatch development paths: moderate `GHSA-q2hr-2g5m-vwhr`, high `GHSA-qhr7-859c-m2p7`, high `GHSA-6j4f-fj2g-mc7p`. It is **not a clean audit**. Its known remediation remains a separate technical increment. Dependencies, dependency policy and lockfile were not changed for B1/B2.

### Manual browser and downloaded-report verification

The local production Data page was exercised at **1440 × 900**, **768 × 844**, **390 × 844**, and **320 × 844**. At narrow widths, results/combined records use cards and the original preview remains locally scrollable. The 320 px mapping controls fit the content width; page-wide horizontal overflow was not observed. Source examples, visible financial choices and row-review actions remain accessible without sideways result-table scrolling.

Verified empty/reset state, CSV ingestion, explicit XLSX worksheet selection, Details → Reference correction, approval gating and review-confirmed versus checked states; all five result filters; warnings and rejected-row inspection; expandable original/staging/candidate/mapping/rule evidence; source lineage and combined pagination; quality definitions; duplicate reuse; only-affected-dataset invalidation and rechecking; processed worksheet restoration and unchecked-choice reset; an unsupported-file failure that clearly identifies the earlier active file; and a checked dataset with all rows rejected and zero accepted output.

Keyboard checks covered native column/select controls, financial choices, review checkbox, filters, disclosure activation, pagination, row-review Escape and focus return, plus Tab/Shift+Tab wrapping to/from the last technical disclosure. These are practical checks, not a complete accessibility-conformance assessment. No browser console errors were observed in the exercised sessions.

The public fixture flow produced **26 processed, 20 Ready, 3 Included — needs attention, 3 Cannot include; 23 included**. Rates remain **88.46% success, 76.92% clean validity, 96.15% required-value completeness**. The latter is presence, not accuracy. Duplicate ledger loading retained 23 rows. Editing a ledger mapping removed its ten rows, leaving 13; confirmation cleared and Needs checking again persisted when switching away and back. Selecting the checked bank Transactions worksheet restored Details → Reference. Rechecking ledger returned the session to 23 accepted rows without duplication.

All three download buttons produced real local files, independently parsed after download:

| Download | Parsed result |
| --- | --- |
| Included-records CSV | **23 data rows, 31 columns**; only `VALID` and `WARNING` |
| Excluded-row-problems CSV | **4 data rows, 13 columns**; `REJECTED` only, for three rejected records |
| Full check-report JSON | **26 processed, 23 normalized**; 20 VALID, 3 WARNING, 3 REJECTED; schema/ruleset 0.1 |

The in-app browser's download event did not return a path, but its native download handling created the files in Downloads; verification used those actual files. Additional isolated synthetic CSV uploads confirmed both differing source dates, Posting-date selection, large exact decimal strings and leading-zero IDs in row review; a blank source currency explicitly defaulted to MYR and blank credit explicitly treated as zero were shown with their source/default/approved-rule explanations. Those synthetic check files remain outside the repository.

### Review scope and package

The final source review covered correctness, readability, architecture, security and rendering cost. The presentation helper consumes existing outcomes and does not implement eligibility. Responsive results render only the current 20-row page per layout; financial values are React text, not HTML. The Data page's only fetch is the existing same-origin synthetic-sample read. No external record transmission, local/session storage, record logging or new credentials were introduced in this increment; existing filename/content guards and CSV escaping remain unchanged.

The independent-review package is `finsight-b12-review.zip`, outside the repository. It includes current application/ingestion source, tests/example/docs/config/public fixtures, fresh REVIEW_GIT_* snapshots, the synthetic workbook under `_review_inputs/`, and synthetic browser screenshots/reports under `_review_evidence/`. The four Git metadata files are review-only and must not be committed. Normal `git diff` omits the two untracked source/test additions; their complete contents are in the ZIP.

For independent verification after extraction:

```bash
pnpm install --frozen-lockfile
pnpm test
FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm audit --json
```

Clean-extraction command results and ZIP integrity/exclusion/size checks are reported with the delivered package after it is created and verified. No commit, push, upload, deployment, contract freeze or shared-repository modification is part of this increment. B1/B2 awaits the requested independent-review gate; finance-staff usability feedback remains future work.

## C1 accepted-data integration contract — 5 October 2026

**IMPLEMENTED IN THE CURRENT WORKING TREE; AWAITING INDEPENDENT REVIEW.** Work began from a clean `feature/ingestion-integration-contract` checkout at `ingestion-ux-v0.1` (`59a4d30c6e4a4a9d0e8c4fa8e848f777cc244b36`). Both checkpoint tags already existed. No branch/tag/commit/push or shared-repository operation was necessary. Earlier verification entries above remain historical evidence, unchanged.

### Implemented boundary and review

The new [accepted-data adapter](../../lib/ingestion/accepted-data.ts) and [contract](accepted-data-contract.md) project only accepted `normalized` transactions, with explicit schema/ruleset compatibility pinned independently to `0.1`. Existing `consolidate()` already exposes retained per-dataset results, so selection/order/replacement are delegated to that boundary without another last-result-wins implementation. Shared dataset/source/batch context and seven existing quality values accompany projected records. Nullable keys, monetary/identifier strings, independent dates, internal status codes, every warning and approved currency/blank-side provenance remain intact.

No full raw/staging/candidate/mapping/options/rejected object, derived ledger net, backend ID, model eligibility flag, network/persistence/security implementation, dependency change or finance UI change is added. Warning/transformation original scalar values remain narrowly scoped and sensitive. Filenames and caller batch IDs are copied exactly; C1 applies no filename normalization or ID generation. **REQUIRES TECHNICAL REVIEW:** current UI reprocessing still reuses one session batch ID, so C1 does not satisfy fresh batch generation. Changed-file replacement association, backend batch scope, external transport versioning and evidence retention/retrieval remain future decisions. Client field/convention confirmations and production limitations remain unresolved.

Five-axis source review covered membership/version preflight, explicit field selection and detached scalar copies, public imports/no circular React dependency, sensitive-value exclusions/no record logging, and linear projection without monetary arithmetic. The new API/example and all affected relative documentation links were checked. Assertions are trusted-producer consistency checks, not external JSON validation or backend authorization.

SHA-256 comparison confirms **72 protected tracked files unchanged**, including engine logic/models/versions/exporters, all ten original test files, the existing consumer, UI/styles, fixtures/evidence and dependencies/configuration. Only the additive public barrel export is changed in an existing engine file. The checked evidence JSON retains SHA-256 `2d3b2dfdbf2b8a215bb42d774e31ac813ec606f4ce164510ff2879400efa5cf6`. Existing CSV/JSON export bytes are independently compared before/after adaptation in the new tests. This section is appended; the earlier verification document prefix remains byte-identical to the checkpoint.

### New contract regressions

[accepted-data.test.ts](../../tests/ingestion/accepted-data.test.ts) adds **41 cases**. The initial seven cases were run before implementation and failed because the public adapter did not yet exist; after implementation they passed. The complete suite independently checks:

- 26 processed source rows; exactly 23 accepted IDs, 20 VALID and 3 WARNING; every one of the three rejected IDs excluded, while rejected counts remain in dataset summaries.
- All-input schema/ruleset preflight before accepted-record access, including replaced inputs; full warning fields and unfamiliar rule strings; reconstructed source lineage.
- Exact filenames and mixed/reused/caller-fresh batch contexts, with no invented global batch or supersession. Replacement/order match the existing public consolidation result.
- Huge signed decimal strings, zeros and leading-zero source/account/entity identifiers; both different source dates under each canonical-date choice; invalid optional-date original values.
- Separate monetary representations, retained extra mapped monetary fields, and excluded ledger-derived net; source/default/missing currency origins; approved blank/null/whitespace-to-zero transformations and actual source zero without a fabricated change.
- The exact transport field boundary, seven unchanged summary values, all-rejected dataset context and empty input; detached typed scalar objects/arrays/metadata/summaries; deterministic processing of deeply frozen inputs and unchanged export bytes.
- Failure without repair/reclassification for impossible rejected normalized status, rejection issues or any of six shared provenance mismatches; accepted-only public usage example with warning lineage and no financial totals.

No existing engine/handoff/export/presentation tests or evidence fixtures were rewritten. Ordinary verification explicitly unsets `FINSIGHT_REGENERATE_HANDOFF_EXAMPLE` to avoid an inherited authoring flag.

### Working-repository commands and actual results

Environment: Node **v25.8.1**, pnpm **11.19.0**, Next.js **16.3.6**, Vitest **4.1.11**.

| Command | Actual result / exit code |
| --- | --- |
| `pnpm test tests/ingestion/accepted-data.test.ts` (initial test-first run) | **7 failed**; exit 1, expected missing public function |
| `pnpm test tests/ingestion/accepted-data.test.ts tests/ingestion/handoff.test.ts` (first adapter slice) | **2 files passed; 20 tests passed**; exit 0 |
| `pnpm test tests/ingestion/accepted-data.test.ts tests/ingestion/handoff.test.ts tests/ingestion/exports.test.ts` | **3 files passed; 57 tests passed**; exit 0, including all 41 new cases |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 268ms using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **10 files passed, 1 skipped (11); 153 tests passed, 1 skipped (154)**; exit 0 |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/MO01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **11 files passed; 154 tests passed (154)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 after clearing conflicting generated cache declarations |
| `pnpm build` | Next.js 16.3.6; compiled successfully, TypeScript completed, **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **0 critical, 3 high, 1 moderate, 0 low, 0 info**; exit 1, unchanged from the fresh pre-C1 audit |
| `git diff --check` | No diagnostics; exit 0 |
| `pnpm start --hostname 127.0.0.1 --port 3097` plus local HTTP request to `/data` | Ready; **HTTP 200**, existing finance workflow headings present. Server stopped intentionally afterward. |

The supplied workbook moved from the older documented `01 Group Assignment` path to `MO01 Group Assignment`; its embedded synthetic-test-only label was confirmed before use. Only its Transactions worksheet is ingested. The unchanged integration test verifies 6,000 accepted positive source amounts, 4,148 DEBIT and 1,852 CREDIT labels, separate monetary fields and row lineage. No accuracy/generalization claim is made.

An early type check failed on pre-existing duplicate generated files such as `routes.d 2.ts` and `cache-life.d 2.ts`. The conflicting build-cache declarations were removed and fresh type generation/type checking/build succeeded. No tracked Next.js/configuration files were changed. The startup HTTP check was repeated after server readiness; this is a route smoke check, not a new finance-user interaction study.

### Actual dependency audit limitation

The current pre/post-C1 audit agrees, but differs from the older B1/B2 report by one additional high development-tooling finding. Manifest, lockfile and installed dependency versions were not changed. `pnpm why braces brace-expansion` confirms these paths are development lint tooling:

| Package/version | Severity | Advisory |
| --- | --- | --- |
| `brace-expansion@5.0.9` | Moderate | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) |
| `brace-expansion@5.0.9` | High | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `brace-expansion@5.0.9` | High | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| `braces@3.0.3` | High | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |

Brace-expansion enters through `eslint-config-next → typescript-eslint → typescript-estree → minimatch`; braces enters through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`. Audit includes development dependencies and exits nonzero. C1 is a verified functional review snapshot with a disclosed audit limitation, not a clean-audit release. No forced resolution, suppression, override or patch was attempted.

### Independent-review package protocol

The new local archive is `finsight-c1-review.zip`, outside the repository, with a single `finsight-prototype/` root. It contains current source/configuration, all tests/examples, controlled public fixtures/evidence, ingestion/handoff documentation, four fresh review-only `REVIEW_GIT_*` snapshots, a portable review guide and the confirmed synthetic workbook under `_review_inputs/`. No earlier review ZIP is overwritten or included. No client data, formal/course documents, local absolute paths, secrets, Git internals, dependencies, environment files, CodeGraph output, caches, logs or deployment metadata belong in the package. Normal Git diff omits untracked additions; their full source files are included.

After clean extraction, independently rerun:

```bash
pnpm install --frozen-lockfile
pnpm test
FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm audit --json
```

Executed clean-extraction results, exact archive size/hash and integrity/exclusion checks are reported with the delivered package after those steps complete. No commit, push, upload, deployment, shared-repository change, backend implementation or production contract freeze is authorized in this increment.

## C2 fresh ingestion execution context — 7 October 2026

**IMPLEMENTED IN THE CURRENT WORKING TREE; AWAITING INDEPENDENT REVIEW.** Work started from clean C1 checkpoint `ingestion-c1-v0.1` (`1bc07b64116106411e7a30ca494eae36dd9ba3e4`) and created the personal `feature/ingestion-batch-lifecycle` branch. HEAD remains at that checkpoint. The earlier verification entries above are historical evidence and remain byte-identical.

### Execution boundary and scope

The public [`ingestDatasetRun`](../../lib/ingestion/run.ts) wrapper requests a new ID/time pair before delegating to the existing engine. Production defaults use `crypto.randomUUID()` and `new Date().toISOString()`; optional `idFactory` and `now` providers support reproducible tests. The Data page calls it only at its existing approved check action and stores only successful returns, including all-rejected completed results. A throwing attempt may consume unused context, stores no new result, and a retry requests another pair. Reopening, inspection, duplicate-file reuse, consolidation, C1 projection and exports reuse existing context.

The session-level batch cache was removed. Results are keyed by dataset identity plus batch identity rather than timestamp; two executions may share a millisecond. Approval, selection, invalidation, result replacement, session reset and finance-facing wording remain unchanged. The C1 adapter received only a lifecycle-comment correction; its executable code, fields and pinned compatibility are unchanged. No backend supersession/persistence, logical-source replacement, network/API, security architecture, AI, dashboard or dependency changes were implemented.

Source review covered execution/failure boundaries, provider calls and same-time runs, input immutability, approved-result storage and existing consolidation, preserved financial/source identities, public imports, sensitive-value handling and the unchanged C1/export boundary. SHA-256 comparison protects **73 unchanged tracked files**, including models/rules, parsing/mapping/validation/normalization/consolidation/serializers, finance presentation components, all eleven earlier test files, existing examples/fixtures/evidence, dependencies and configuration. The previous C1 review archive remains unchanged. Historical evidence JSON is not regenerated.

### New lifecycle regressions

[ingestion-run.test.ts](../../tests/ingestion/ingestion-run.test.ts) adds **11 cases**. The first four tests ran before the wrapper existed and failed with the missing public function; they passed after implementation. A temporary cached-ID mutation then failed the fresh-run regression with `expected ... to be called 2 times, but got 1 time`; the correct wrapper was restored byte-for-byte.

- One ID/time request per attempted execution reaching the wrapper, including attempts that throw in the existing engine; only returned results are stored and retries receive fresh pairs.
- Fresh production UUID/UTC defaults, independently injected providers, unchanged context validation and failure without invented fallback for an invalid clock.
- Separate and same-millisecond executions; all-rejected completed results retain their context without forwarding rejected rows.
- Ledger A, bank B and ledger reprocessing C preserve source IDs/file hashes and existing latest-supplied-result ordering; controlled fixtures still yield **26 received, 23 accepted, 20 VALID, 3 WARNING, 3 REJECTED** and **0 rejected forwarded** through C1.
- C1 preserves new context; inspecting/consolidating/projecting/exporting existing results generates nothing. No supersession fields are introduced.
- Frozen-input purity, exact financial/identifier strings and byte-for-byte identical evidence/canonical/rejected serializers for identical engine context.

### Working-repository commands and actual results

Environment: Node **v25.8.1**, pnpm **11.19.0**, Next.js **16.3.6**, Vitest **4.1.11**. Verification unsets the authoring-only `FINSIGHT_REGENERATE_HANDOFF_EXAMPLE` flag.

| Command | Actual result / exit code |
| --- | --- |
| `pnpm test tests/ingestion/ingestion-run.test.ts` (initial test-first slice) | **4 failed**; exit 1, expected missing public function |
| `pnpm test tests/ingestion/ingestion-run.test.ts tests/ingestion/accepted-data.test.ts tests/ingestion/contract-regressions.test.ts` (first wrapper slice) | **3 files passed; 77 tests passed**; exit 0 |
| `pnpm test tests/ingestion/ingestion-run.test.ts tests/ingestion/pipeline.test.ts tests/ingestion/accepted-data.test.ts` | **3 files passed; 69 tests passed**, including all 11 new cases; exit 0 |
| Temporary cached-ID mutation; focused fresh-run regression | **1 failed, 10 skipped**; exit 1, expected detection; correct source restored |
| `pnpm install --frozen-lockfile` | `Already up to date`; `Done in 212ms using pnpm v11.19.0`; exit 0 |
| `pnpm test` | **11 files passed, 1 skipped (12); 164 tests passed, 1 skipped (165)**; exit 0 |
| `FINSIGHT_WORKBOOK_PATH='../04 Modules/MO01 Group Assignment/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test` | **12 files passed; 165 tests passed (165)**; exit 0 |
| `pnpm lint` | `$ eslint`, no diagnostics; exit 0 |
| `pnpm exec next typegen` | `Generating route types...` / `✓ Types generated successfully`; exit 0 |
| `pnpm exec tsc --noEmit --incremental false` | No diagnostics; exit 0 |
| `pnpm build` | Next.js 16.3.6; compiled successfully, TypeScript completed, **11/11 static pages generated**; exit 0 |
| `pnpm audit --json` | **0 critical, 5 high, 1 moderate, 0 low, 0 info**; exit 1, same advisories as fresh pre-C2 audit |
| `git diff --check` | No diagnostics; exit 0 |
| `pnpm start --hostname 127.0.0.1 --port 3098` and local browser workflow | Production server ready; interactive checks below; server stopped after verification |

The requested `../04 Modules/01 Group Assignment/...` path is absent in this checkout. The already-supplied file exists under `MO01 Group Assignment`; its README worksheet still explicitly labels it synthetic test data only. No course folder/file was moved or changed. Its SHA-256 is `13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb`. The unchanged optional integration test checks the 6,000-row Transactions worksheet, 4,148 DEBIT / 1,852 CREDIT labels and source lineage. The review archive uses the portable `_review_inputs/` path below.

### Manual browser checks and limits

The local production-build Data page was exercised with controlled synthetic files. Approval remained mandatory; the bank worksheet was selected explicitly and Details was changed to Reference before checking.

- Ledger and bank executions received different batch IDs/timestamps.
- Reopening ledger preserved its original pair. Rechecking it created a new pair with the same source-row ID and file fingerprint.
- Changing ledger mapping removed only ledger's results, leaving bank's eight included rows. Restoring/reapproving/rechecking created another fresh pair; reopening bank confirmed its pair was unchanged.
- Edge cases remained **2 Ready, 3 Included — needs attention, 3 Cannot include**. Rejected source row 7 and its original invalid date remained inspectable with the execution context.
- Combined totals remained **3 files / datasets, 26 checked, 20 Ready, 3 needing attention, 3 excluded, 23 included**.
- All three download controls were triggered; inspection and duplicate-file reuse preserved the existing context. The in-app browser's download-event API timed out, so downloaded file bytes were **not** independently retrieved through that API. Automated serializer byte-equality tests passed; this is not a claim of captured browser-download bytes.
- Clearing the session removed results. Checking ledger afterward created a sixth distinct execution ID with the same source-row identity. The captured browser console contained **0 errors**.

The synthetic browser summary screenshot and bounded ID/count report are included in the review package. No client data or complete browser record dump is included. These are local interaction checks, not a production/backend or accounting-accuracy claim.

### Audit limitation at the unchanged dependency boundary

The fresh pre/post-C2 advisories agree. They differ from the older C1 report by two additional high findings. Manifest, lockfile and installed dependency versions are unchanged; dependencies were not updated, overridden or suppressed.

| Locked package | Severity | Advisory / actual dependency category |
| --- | --- | --- |
| `brace-expansion@5.0.9` | Moderate | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr); development ESLint/TypeScript tooling |
| `brace-expansion@5.0.9` | High | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7); same development path |
| `brace-expansion@5.0.9` | High | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p); same development path |
| `braces@3.0.3` | High | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); development `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch` |
| `source-map-js@1.2.1` | High | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q); `next → postcss`, also Tailwind/Vitest development paths |
| `sharp@0.35.4` | High | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w); optional `next → sharp` dependency |

These are not all development-only paths. This increment has a disclosed nonzero dependency audit; it is not a clean-audit release or an exploitability assessment. Remediation requires a separate authorized dependency task.

### Separate C2 independent-review package

`finsight-c2-review.zip` is created outside the repository with one `finsight-prototype/` root, current source/docs/tests/configuration, controlled fixtures, four fresh review-only `REVIEW_GIT_*` snapshots, a portable review guide and the synthetic workbook under `_review_inputs/`. Previous review ZIPs are not regenerated or included. Exclusions cover client data, unrelated course/personal material, local absolute paths, Git internals, dependencies/caches/build output, environment files/secrets, CodeGraph output, logs and deployment metadata.

The complete contents of the two new untracked source/test files are included; ordinary Git diff/stat omits them. Review metadata is not a project artifact to commit. Clean-extraction results, archive size/hash/integrity and exclusion checks are reported after packaging.

Independent verification from the extracted repository:

```bash
pnpm install --frozen-lockfile
pnpm test
FINSIGHT_WORKBOOK_PATH='./_review_inputs/SAIC_HF_Augmented_Bank_Transactions_v2.xlsx' pnpm test
pnpm lint
pnpm exec next typegen
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm audit --json
```

Stop at the independent-review gate. No commit, push, upload, deployment, shared-repository modification or backend implementation is part of C2.


## FinGence local directory and branding migration — 12 October 2026

Local review candidate on `feature/fingence-branding`, based on `ingestion-c2-v0.1` (`88f2e23`). No commit, push, merge, deployment, domain change or production-setting change was performed.

The primary directory is now `FinGence`. `git worktree repair` exited 0 and repaired the linked team worktree's administrative pointer. Its branch (`feature/data-ingestion-chia`), HEAD (`161b489`) and all 76 checked tracked files remained unchanged. Existing branches/tags, Git remotes and local Vercel project linkage were preserved. CodeGraph CLI sync/status work at the relocated path; the stopped MCP connection needs reconnection in Codex.

The three pre-existing modified samples were copied outside the repository, verified against their SHA-256 hashes, and preserved in a path-scoped stash. The checkout and review package use the committed C2 fixtures. Neither fixtures nor checked evidence were regenerated. The external original logo is retained; its in-repository copy is byte-identical, SHA-256 `81a704a60091e1af1b6016be3018828d2652a487cab068fa84217d00e5100e7a`.

Runtime: Node `25.8.1`, pnpm `11.19.0`, Next.js `16.3.6`; dependency manifests/lockfile unchanged.

| Executed command | Result | Exit |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Lockfile up to date; installation succeeded | 0 |
| `pnpm test` | 11 test files passed, 1 skipped; 164 tests passed, 1 skipped (165 total) | 0 |
| `pnpm lint` | No lint findings | 0 |
| `pnpm exec next typegen` | Route types generated successfully | 0 |
| `pnpm exec tsc --noEmit --incremental false` | No TypeScript diagnostics | 0 |
| `pnpm build` | Production build passed; 13/13 static pages generated | 0 |
| `pnpm audit --json` | 0 critical, 6 high, 5 moderate, 1 low | 1 |
| `git diff --check` | No whitespace errors | 0 |

The first build rejected RGB PNG entries in the ICO file. Regenerating the derived favicon with opaque RGBA entries resolved this; the original artwork/PNG was unchanged. The subsequent build passed. Audit findings remain a separate security/dependency backlog, including runtime paths; no package updates or audit suppression were performed.

Manual checks used the local production build (`pnpm start --hostname 127.0.0.1 --port 3100`) and Codex's in-app browser. Desktop 1440 × 900, mobile 390 × 844 and narrow 320 × 844 layouts showed FinGence branding without page-wide horizontal overflow. The report masthead retained its mock-data notice. Browser title/description and favicon, PNG icon and Apple touch-icon links were correct; all five branding assets returned HTTP 200 with bytes matching the files. No application console errors/warnings were recorded in the final ingestion test tab.

The original built-in CSV/XLSX samples were read and checked: ledger 10 Ready; bank Transactions worksheet 8 Ready after Details → Reference correction; edge cases 2 Ready, 3 Included — needs attention, 3 Cannot include. Combined output: 26 received, 20 VALID, 3 WARNING, 3 REJECTED, 23 accepted. Rechecking the ledger produced a different batch UUID with the same source-row identity. A rejected invalid-date row remained inspectable.

All three browser downloads were retrieved and independently parsed: included CSV 23 accepted rows; rejected report 4 issues across 3 source rows; evidence JSON 26 processed/23 normalized, with schema/ruleset `0.1` and the reprocessed ledger batch retained. Existing C1/C2, exact-value, lineage and serializer regressions passed, and 47 protected source/test/fixture/configuration files were byte-checked against the C2 baseline. The Data page changed only two product-name strings.

The direct file-picker automation timed out, so picker-based upload was not marked verified; sample-file loading and unchanged reader tests cover CSV/XLSX ingestion. The optional supplied 6,000-row workbook was unavailable under `04 Modules`; its integration test remained skipped. Screenshots and command/export verification artifacts were saved outside the repository for independent review. The old website URL and live C2 deployment were retained.
