# Increment 03 executed verification

25 October 2026; isolated macOS arm64 worktree; Node24.22.0, pnpm11.19.0, Python3.12.
**Credential-free implementation; no LLM dispatch, key setup, paid inference or model download.**
Earlier increment evidence is preserved rather than rewritten.

| Executed command/check | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` | Exit0; dependency/lock bytes unchanged from pre-Increment03 snapshot |
| `pnpm test --maxWorkers=1` | Exit0; **525 passed, 9 skipped (534)**; **46 files passed, 2 skipped (48)**; 106.88s |
| `pnpm lint` | Exit0; no warnings |
| `pnpm typecheck` | Exit0; Next type generation and `tsc --noEmit --incremental false` |
| `pnpm check:server-boundary` | Exit0; existing real package-guard/import-boundary check |
| `pnpm build` | Exit0; production build, including local-only dynamic page/API |
| `.venv-ai/bin/python -m pip check` | Exit0; no broken requirements |
| `node --conditions=react-server scripts/ai-increment-03.mjs doctor` | Exit0; provider unavailable; zero actual reservations/tokens; no credential values printed |
| CLI held-out/regression no-inference evaluation | Exit0 each; 8 +26 documents; live runs0; field results in evaluation document |
| `pnpm audit --json` | Exit1; **2 critical, 7 high, 12 moderate, 2 low**,0info; graph unchanged |
| `git diff --check` | Exit0 |

Thirty-three new tests exercise evidence-only materialization, strict provider requests,
durable quota reservations/limits, cancellation, unknown outcomes, malformed/empty receipts,
post-dispatch ledger failures, local route boundaries, independent scoring, explicit resume
and source integrity, and real held-out extraction through the unchanged financial verifier.
Existing tests were not edited. The new eight-document integration test is optional when
its external Python runtime is absent; it ran in this working environment.

Nine skipped tests are eight native Windows PostgreSQL-binary tests and the optional
6,000-row workbook test without an available configured workbook path. Disposable PGlite
checks ran in the full suite. No native PostgreSQL or hosted database success is claimed.

## Failures retained and resolved

- Initial import/module-not-found failures established the new tests' missing implementations.
- The first full-suite attempt exposed the new route's unresolved Vitest `@/` import;
  it now uses a relative server import and the route tests pass.
- A later parallel full run reported **524 passed,1 failed,9 skipped**: the held-out OCR
  worker returned a bounded extraction failure while OCR evaluation was also running.
  The exact underlying worker failure was not established. No fixture/verifier was weakened.
  The full controlled rerun used `--maxWorkers=1` with no concurrent OCR jobs and passed
  **525/9**. Use that command for reproducible resource-bounded verification on this machine;
  default-parallel reliability under resource contention is not claimed.
- A fresh-context reviewer reproduced missing receipts for unusable acknowledged responses,
  late cancellation reaching verification, and dispatched failures/ledger errors being
  mislabeled as not executed. Failing regressions preceded the fixes. Receipts are retained,
  cancellation accepts0, and uncertain attempts carry `DISPATCHED_UNKNOWN` plus reservation
  identity; no automatic retries or refunds. POSIX ledger rename is directory-fsynced.
- Missing resume paths and source-byte/manifest mismatch now fail before processing.

## Browser verification — actual local application

CSV sample processing and native XLSX file upload executed actual extraction. Scanned PDF
processing completed through the same upload API. Each ended with inference BLOCKED,
`NOT_EXECUTED`, and no accepted records. Changing files cleared the previous result.
The JSON evidence download was opened/parsed. Technical source evidence remains accessible.
Desktop,390px and320px views were inspected; no whole-page horizontal overflow at the narrow
widths. Browser error-log checks returned no errors. Screenshots show the truthful blocked
state, not a fabricated successful live model run. Browser live-success behavior remains untested.

## Preservation and known backlog

A hash/CRC-verified external source snapshot was taken before editing. Of281 preexisting
files,277 remain byte-identical. The four modified files are the three narrow 0.2 origin
extensions and the shell's new-route notice exclusion. No financial verifier condition,
canonical model, schema/ruleset0.1, C1/C2 source, fixture, previous report, dependency file,
main branch, tag, stash or protected sample backup was changed. Three original/released
worktrees remain clean. See [preservation JSON](evidence/preservation.json).

The fresh audit's two critical advisories concern Next.js image-optimization/SVG and typed-array
`use cache` paths (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr). Applicability/exploitability was
not assessed here. Full advisories are retained in [audit JSON](evidence/audit.json). No package
upgrade or security-remediation claim is included; this remains a separate hardening backlog.

Windows/Katana execution, lab Ollama/GPU measurements, provider access, live strict-schema
acceptance and genuine inference accuracy remain unverified. A source review package is
prepared for independent inspection; that is not external acceptance or production readiness.

## Source-only package verification

Clean extraction passed frozen install, serial tests, lint, typecheck, server-boundary checks
and production build (all exit0). It ran **513passed,21skipped (534)**,45filespassed3skipped.
Twelve extra extraction tests were skipped because the external Python/model environment
is deliberately not bundled; this is not a second OCR execution. The configured development
worktree result remains525passed9skipped. See [clean results](evidence/clean-extraction.json).

The first packaging attempt omitted the existing ignored pnpm-workspace.yaml, causing
ERR_PNPM_IGNORED_BUILDS on clean install. The package was corrected to include that existing
file unchanged (sharp:false, unrs-resolver:false), then successfully re-extracted/verified.
No source/dependency/build-policy change or package approval was performed. Final package
documentation/manifests were refreshed afterward; executable source/config/fixtures match
the successfully tested extraction byte-for-byte, verified by the adjacent package QA JSON.
