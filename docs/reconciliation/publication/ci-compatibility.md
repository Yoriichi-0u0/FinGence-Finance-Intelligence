# PR #40 — local CI compatibility review

31 October 2026. These changes are implemented locally only. No commit, push, PR edit, workflow rerun, merge or deployment has been performed for this fix.

## Scope and original failures

GitHub Actions run 41175183855 reported 1,073 passed, three failed and 54 environment/opt-in skips. Two existing AI05 unit tests called buildFreeze and required an external runtime/model installation unavailable on the hosted runner. The unchanged DB03 historical integrity test needed commit 3637faa10fd1f42304d983ff5be420e9ec72dea8, but checkout used fetch-depth 1.

The historical reference is correct. Its DB01 manifest and all 389 artifacts/14 sources verify from Git objects; DB02's nine artifacts/ten sources also verify. No reference, assertion, financial rule, model configuration or historical evidence is changed.

## Exact implementation files

| File | Change |
| --- | --- |
| .github/workflows/saic-verification.yml | Fetch full history, run the explicit CI test profile, then verify published research from Git objects. Remaining workflow steps are unchanged. |
| scripts/ai-research/vitest.ci.config.mts | New profile with two isolated projects. Standard tests retain the existing tests/**/*.test.ts catalogue; the existing AI05 metrics file and new boundary file run in the dedicated unit project. No test is dropped. |
| tests/reconciliation/ai05-ci-freeze.setup.ts | Test-only filesystem fixture, its self-consistent synthetic asset manifest, fault controls, and real-inference/official-evaluation prohibition. |
| tests/reconciliation/ai05-ci-freeze.test.ts | Seventeen new mandatory boundary regressions. |
| docs/reconciliation/publication/ci-compatibility.md | This implementation, verification and limitation record. |

The original root Vitest configuration, AI05 metric test file, buildFreeze/validateFreeze implementation, model worker, official runner/evaluator, DB03 tests and all frozen research files are untouched.

## Synthetic unit environment versus actual model integrity

The unit project intercepts only the model manifest and exact external runtime/model asset paths, plus two explicit invalid-configuration fault cases. All financial source fixtures, policies, algorithms and cryptographic functions remain real. The fixture holds six tiny text buffers and computes their SHA-256 values with Node's real crypto implementation. Its manifest is explicitly UNIT_TEST_ONLY_NOT_FOR_INFERENCE and names a synthetic non-model repository. It is not written to disk and never replaces the authoritative model configuration.

The approved revision string is retained only to exercise the unchanged revision allowlist. Synthetic asset hashes deliberately differ from all authoritative model hashes. A dedicated negative test requests the authoritative hashes with synthetic bytes and confirms a checksum failure. No test claims those bytes verify the real pretrained model.

Missing runtime/model files, wrong library/revision/dataset versions, corrupt bytes, incorrect hashes, inconsistent date policy and configuration drift all fail closed. Original financial-safety tests still execute; none is skipped to obtain a pass.

The CI profile refuses AI03_REAL=1 and any nonempty AI05_STAGE before test collection. Setup repeats that guard. The unit project also rejects real worker construction and official prediction, environment validation and label evaluation entry points. Three child-process regressions demonstrate that real-inference/prediction/evaluation flags fail at configuration loading. The pure assertSealBytes helper remains the actual implementation.

Mocks are scoped to the dedicated Vitest project and isolated test contexts, not installed globally or used by application code. The new boundary test imports its setup first so it also runs safely in the ordinary local profile. The original AI05 metrics file uses the real environment under that ordinary profile. Test context isolation is a software boundary, not an OS security sandbox.

Actual inference and official evaluation retain the original runtime version and all six real-file hash checks. They must run separately, with the approved real runtime and model, outside this synthetic profile. A standalone Node invocation of the existing AI05 verifier checked actual model files and official seals independently of Vitest mocks. No inference or official evaluation was rerun and no model/runtime was installed or downloaded.

## Full verification and no-exclusion proof

All result JSON files are retained outside the repository under ../outputs/ai-ci-compatibility-2026-10-31/ so historical evidence is not overwritten.

| Execution | Passed assertions | Failed assertions | Existing skips | Additional suite/hook failure |
| --- | ---: | ---: | ---: | --- |
| Complete ordinary profile in existing Windows checkout | 1,141 | 1 | 5 | None |
| Complete CI profile in the same checkout | 1,141 | 1 | 5 | One DB03 directory-removal EPERM after 24 recovery assertions passed |
| Complete CI profile in isolated LF checkout, no sibling model/runtime | 1,142 | 0 | 5 | None |

The clean run covered 65 files: 62 passing and three containing only existing skipped cases. It included all 49 available native PostgreSQL tests (24 recovery and 25 persistence/concurrency), all ten original AI05 metric tests, and seventeen new fixture/isolation tests. The clean verification checkout came only from local Git objects, with the four proposed code/config files overlaid and existing project dependencies reused through a local junction. It performed no network clone, dependency install, model download or commit. Full historical Git objects were available there.

An exact comparison of normalized test paths, full test names, multiplicity and assertion status showed the ordinary and CI runs in the original checkout contain the same 1,147 cases. No tests were omitted, duplicated or newly skipped. The clean run has the same catalogue and skip set; only the existing DB01 failure changes to a pass.

The five unchanged skips are: the opt-in full DB01 performance matrix, the unavailable supplied workbook, the historical AI03 evidence-writing real-model test and the two completed one-shot official AI05 stages. Their eligibility flags were not changed. On Linux the existing native Windows-tool availability gates still apply; this profile does not claim that those tests ran on GitHub.

Project TypeScript and strict lint pass. The historical/publication Git-object audit verifies 378 references. Real-model file checks are separate from synthetic unit tests. Saved research outputs and the 13 pre-existing local DB03 files are checked byte-for-byte against the starting snapshot.

## Honest remaining environment limitations

The original checkout's DB01 environment.json has CRLF bytes while the recorded byte-exact artifact and Git blob use LF. Both ordinary and CI profiles correctly reject that working-copy artifact. Its Git SHA-256 is 77e7f3b0333b97caf4175470f92569eabd3f700117fae6fce5f897b27834028a; its current checkout SHA-256 is d82ce6038c64b4b936112d4665ae1b79a94e605bfa94dc454ce6632a4dbb67be. No normalization, rewrite, mock or skip was added to bypass the DB01 test. A separate LF checkout passes the unmodified test.

One Windows native recovery run encountered EPERM removing its own temporary directory after its assertions passed. The failure report is retained; it is not counted as a successful suite. Diagnostic location: ../ai01-m2-temp/fingence-db03-fwfZL4/. The owner marker remains and no postmaster.pid files remain. No manual deletion was attempted. The clean-checkout full run subsequently passed the recovery suite and cleanup without changing its code.

Initial TypeScript checks identified a ProcessEnv weak-type mismatch and a Node readFileSync overload typing mismatch in the new setup. Explicit environment fields and an encoding-preserving overload bridge corrected those errors; the final project check passes. A sandbox-denied dependency-junction creation was completed through the normal local tool approval mechanism. Neither issue affected frozen research.

GitHub has not run this unpublished workflow change. Later hosted lint/build/schema steps still require a real Actions run after separate publication approval. No production, hosted Supabase, teammate, PR #2 or PR #35 changes are included.

## Verification commands

Use a writable local TEMP/TMP and disable evidence-writing/one-shot flags. DB03_EVIDENCE and DB02_EVIDENCE remain empty. DB03_REQUIRED=1 ensures available native recovery is not silently skipped locally.

```powershell
pnpm exec vitest run --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=json --outputFile=../outputs/ai-ci-compatibility-2026-10-31/baseline-full.json
pnpm exec vitest run --config scripts/ai-research/vitest.ci.config.mts --maxWorkers=1 --reporter=json --outputFile=../outputs/ai-ci-compatibility-2026-10-31/ci-current-checkout-full.json
# Same CI command in the isolated local LF checkout, with output redirected outside it:
node node_modules/vitest/vitest.mjs run --config scripts/ai-research/vitest.ci.config.mts --maxWorkers=1 --reporter=json --outputFile=../ci-clean-checkout-full.json
pnpm typecheck
node node_modules/eslint/bin/eslint.js research/reconciliation tests/reconciliation scripts/ai-research docs/reconciliation/evidence/ai05/evaluation-only/independent-audit.mjs --max-warnings=0
node scripts/ai-research/verify-publication.mjs HEAD
# Actual installed model integrity, separate process, no synthetic setup:
node research/reconciliation/ai05/verify.mjs --model
```

## Proposed commit message — not committed

```text
fix(ci): isolate AI05 unit assets and fetch historical evidence

Summary:
- Fetch full Git history for the unchanged DB03 historical integrity test.
- Route AI05 freeze unit tests through a scoped synthetic manifest with real SHA256 checks.
- Add missing-file, version, corruption, drift and real-mode isolation regressions.
- Preserve frozen research code, official results, authoritative model pins and local DB03 work.

Verification:
- Clean-checkout full suite: 1,142 passed, zero failed, five existing skips.
- Exact 1,147-case catalogue parity with the ordinary profile; no new exclusions or skips.
- All 49 available native PostgreSQL cases passed in the clean run.
- TypeScript, strict lint, 378 publication integrity references and separate real-model hashes passed.

Limitations:
- Original Windows checkout retains the known DB01 CRLF artifact mismatch.
- One native cleanup EPERM is recorded with retained diagnostics; clean-run recovery passed.
- Hosted CI has not rerun these unpublished changes; no official experiment was rerun.
```
