# AI01 M2 benchmark-quality correction — engineering report

30 October 2026, Asia/Singapore. Current dataset: **ai01-m2/1.1.0**. This report supersedes the 28 October M2 verification narrative; historical evidence under evidence/m2/ describes version 1.0.0 and is preserved unchanged. The original complete review ZIP remains outside the repository.

## Finding and implemented correction

The independent review finding supplied in the task was confirmed by inspecting the generator and by independently auditing the previous frozen ZIP: all 60 SUGGEST_PAIR outcomes had a unique reference-plus-amount/currency/direction counterpart. No separate M2 reviewer report was present in the inspected reconciliation files; the existing review-baseline.json concerns the earlier M1 corrections.

Version 1.1.0 changes only the B/C/D evidence in each of six source blocks. These are three separate, same-value outflow payments to the same supplier on the same transaction/posting date. Delivery, equipment repair and supplies have different economic purposes:

| Family | Bank description | Ledger description | References |
| --- | --- | --- | --- |
| B | TRF delivery charge + merchant | Caj penghantaran / freight + merchant | Both unavailable |
| C | EQP RPR + abbreviated merchant | Equipment repair / baik pulih peralatan + merchant | Independent bank booking and supplier document references |
| D | Payment for supplies + merchant | Bayaran bekalan + merchant / payment received | Bank unavailable; ledger retains its document reference |

The original economic relationships remain unchanged. Six directed cross-service DISTINCT_EVENT negatives per block add 36 required labels, taking negative edges from 48 to 84. The independently authored annotations.ts inventory requires all new edges. Omitting a required edge or contradicting a true pair is rejected. The validator now also rejects reintroducing shared references, unique non-description context, or generic identical service descriptions into this version-specific coverage.

The B/C/D amounts and source signed/debit/credit representations are generated consistently from one exact BigInt-derived value per block. Dates remain valid for every schema's declared basis. No existing financial amounts outside B/C/D were intentionally changed; version-domain hashing regenerates opaque IDs, references and seeded amount offsets across the new dataset, so 1.0.0 and 1.1.0 identities must not be joined. No production data exists in either fixture.

The illustrative multilingual/abbreviated phrases were selected for plausible payment-purpose evidence, not through model scoring. There was no E5 inference, tuning, model download or search for favorable model examples. Dictionaries, deterministic text rules or fuzzy matching may perform well; this correction establishes useful description coverage, not superiority of a model.

## Independent diagnostics

The read-only diagnostics.mjs imports no generator, scenario board, validator or feature projection. It examines parsed frozen input and separate labels. Its exact probe requires a non-null equal reference and exact amount/currency/direction, uniquely identifying the true ledger record. Its context probe compares amount/currency/direction, all available dates and counterparty without descriptions/references. Private IDs address evidence only; they are never a ranking feature.

| Split | Rows / schemas | Suggested pairs | Exact-reference unique before → after | Description-dependent after | Ambiguous-pair abstentions |
| --- | --- | ---: | --- | ---: | ---: |
| Train | 150 / 6 | 30 | 30 → 21 | 9 | 15 |
| Development | 50 / 2 | 10 | 10 → 7 | 3 | 5 |
| Held-out | 100 / 4 | 20 | 20 → 14 | 6 | 10 |
| Total | 300 / 12 | 60 | 60 → 42 | 18 | 30 |

Each of the 18 description-dependent suggestions has three non-description-compatible ledger candidates, including the genuine counterpart and two explicitly negative alternatives. B has no references, C has differing references, and D has a missing bank reference. Exact reference equality cannot pick the true edge. Descriptions distinguish service purposes. This is a coverage audit, not recall/precision/F1 or a complete matching baseline. No AI02 matcher is implemented.

[Before/after diagnostic evidence](evidence/m2-correction/diagnostics.json) includes per-pair IDs and candidate sets. Reproduce the current read-only audit from the repository root:

```powershell
node research/reconciliation/m2/diagnostics.mjs
```

## Preserved boundaries and financial integrity

The 12 source schemas and their exact definitions, 300 rows, 150 BANK / 150 LEDGER balance, 150/50/100 split allocations and four unseen held-out schemas are unchanged. Source periods, lineage structure and split-specific merchant domains are unchanged. All 96 true pairs, six complete groups, six partial groups and 72 unmatched rows retain their economic membership and outcomes. Thirty true pairs still abstain for ambiguity, six for insufficient evidence; twelve groups and 72 unmatched records remain unresolved. E/F/N/O still have identical permitted features, including dates, and cannot be safely resolved by text or exact-date tie-breaking.

Ground truth remains in separate annotation sidecars. SUGGEST_PAIR is a provisional experimental recommendation, never financial confirmation; a future system may abstain. Exact decimal strings/BigInt semantics, currency/direction checks, NULL-as-unavailable, financial negatives, group conservation/outstanding balance, accepted eligibility, source identity and isolation checks are retained. M1 is byte-preserved, including its frozen fixture and independent integrity manifest. DB01–DB03 source, migrations, historical evidence, existing runner modification and preliminary files are preserved.

## Verification

Final results and machine-readable evidence are listed in checks.json. Final focused AI01 tests: **213 passed, 0 failed, 0 skipped** across eight files (106 unchanged M1 tests and 107 M2 tests). Five new quality tests cover independent frozen diagnostics, equal-context competitors, required negatives, shared-reference regression and loss of descriptive evidence.

Commands (repository root):

```powershell
# Use a writable local TEMP/TMP if the sandbox cannot rename Vitest cache files.
pnpm exec vitest run tests/reconciliation --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/m2-correction/ai01-tests.json
pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/m2-correction/regressions.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation/m2 tests/reconciliation/m2-generation.test.ts tests/reconciliation/m2-validation.test.ts tests/reconciliation/m2-access.test.ts tests/reconciliation/m2-artifacts.test.ts tests/reconciliation/m2-quality.test.ts --max-warnings=0
git diff --check
git diff --cached --check
```

Final combined results: **737 passed, 0 failed, 0 skipped across 29 files**, including **25 native PostgreSQL tests**. TypeScript and strict targeted lint passed with zero warnings. Git whitespace checks passed. The correction is ready for independent engineering review.

The combined suite includes the AI01 tests, existing API/persistence/grouped regressions, native disposable PostgreSQL tests and DB03 safety/history tests. It does not rerun the DB01 benchmark or DB03 recovery drill. The DB03 config disables environment-file loading. The existing native harness initializes a new cluster bound to 127.0.0.1 and never uses an existing database or hosted Supabase.

Development failures are retained honestly: the first quality invocation hit a sandbox temporary-cache rename EPERM before running tests. With a writable local temp directory, both initial regression tests failed against 1.0.0 as intended. An intermediate edit exposed a Python default-codepage issue and duplicate object properties; UTF-8 edits and TypeScript corrections resolved these. The first broader run recorded 642 passed, 46 failed and 49 skipped due to sandbox loopback EACCES/database-unavailable errors; its report is preserved separately as regressions-sandbox-failure.json. The unchanged disposable harness was rerun through the normal approval mechanism. None of these initial failures/skips is counted as a final pass.

Nine frozen artifacts were regenerated explicitly and then verified in normal test mode. Source hashes use CRLF-to-LF normalization; JSON artifacts and evidence are byte-exact SHA-256. The updated outer manifest covers current M2 source/docs, frozen data and both historical and current evidence. The preserved M1 manifest is independently verified. The ZIP entry set and every extracted byte are compared with the workspace.

## Files and review package

Existing M2 source modified: schemas.ts (version only), scenarios.ts, annotations.ts, generator.ts and validator.ts. New source: diagnostics.mjs. Existing test modified: m2-generation.test.ts (negative counts). New test: m2-quality.test.ts. All nine files under m2/fixtures/ are regenerated. M2 README, dataset specification, split protocol, this report and the M2 integrity manifest are updated. Five new correction evidence files contain diagnostics, focused tests, combined tests, the initial sandbox failure and checks. The complete exact inventory and hashes are in checks.json and ai01-m2-integrity-manifest.json.

The complete updated review ZIP includes every original M1 file plus all current M2 files, frozen fixtures, documentation, tests and evidence. No raw database, WAL, credentials, caches, dependencies or real financial documents are included. Historical M2 evidence is clearly dated and does not certify 1.1.0 source.

## Limitations and readiness

Same-value service collisions are deliberately authored research coverage, not evidence of natural frequency. Shared scenario grammar, merchant phrasing and repeated service categories can create synthetic shortcuts. Held-out schema separation does not mean unseen semantic families. Reviewers can inspect held-out truth; evaluator governance remains necessary. This audit does not prove that descriptions uniquely establish economic reality in real banking records, nor that any model outperforms rules or fuzzy matching. Production tolerances, human approval, candidate policies and broader real-source evaluation remain separate decisions.

Branch remains feature/backend-celester, upstream origin/feature/backend-api-celester, HEAD 9385da7f4bb5ef9abbf2dec39b31e60e639fcaca. Nothing is staged or published. The pre-existing scripts/db03/run.mjs modification and three untracked DB03 evidence directories remain untouched. AI01 files remain untracked in this checkout. No production schema/API/ingestion/security code was changed. No hosted database, AI inference, AI02, AI03, commit, push, merge or deployment was performed.
