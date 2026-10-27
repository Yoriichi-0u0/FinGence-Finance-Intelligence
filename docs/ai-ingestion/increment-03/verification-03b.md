# Increment 03B verification — 27 October 2026

Base: `9daf2662781a40155ae48fe41b314102176642e8`, personal experimental
`feature/v2-multimodal-ingestion`. Node 24.22.0, pnpm 11.19.0, Next.js 16.4.1,
local Python 3.12/Docling/RapidOCR on the MacBook Air M2 with 16 GB memory.
No credentials, provider calls, paid inference, model downloads, Supabase or production changes.

## Executed checks

| Command/check | Actual outcome |
| --- | --- |
| Pre-change full configured suite | 525 passed, 1 extraction failure, 8 skipped; unchanged held-out test reported bounded worker failure |
| Pre-change isolated held-out rerun | 2 passed, including all eight frozen documents; no source/extractor change before rerun |
| New refinement tests before implementation | Failed as expected on missing evidence groups/schema/guidance; preserved failure replay/control tests already passed |
| New resume/mapping metric tests before helpers existed | Failed as expected; red logs retained |
| `pnpm install --frozen-lockfile` | PASS; dependency files unchanged |
| `pnpm test --maxWorkers=1` with local workbook and OCR interpreter configured | **547 passed, 8 skipped; 48 test files passed, 1 skipped**; 112.48 s final suite time |
| Focused workbook test with verbose reporter | PASS; 6,000 rows accepted, zero rejected, 4,148 DEBIT / 1,852 CREDIT source directions; test 2,659 ms |
| `pnpm lint` | PASS |
| `pnpm typecheck` (`next typegen` then nonincremental `tsc`) | PASS |
| `pnpm check:server-boundary` | PASS |
| `pnpm build` | PASS; existing filesystem-tracing warnings remain; private trace exclusion check passed |
| Local production isolation with both enable flags present | Three pages 404; six API requests 403/404; zero private AI/evaluation trace files |
| Local development browser | Registered h01 CSV extracts 19 evidence items; NOT_EXECUTED, inference blocked, no accepted financial records; no captured warning/error console entries |
| Cross-format request checks from actual extracted evidence | 33 requests checked: correct disjoint ID groups, exact source literals and all policy aliases preserved; corrupt PDF has no request |
| `pnpm audit --json` before and after | Exit 1 both times; **0 critical, 4 high, 7 moderate, 1 low**, identical advisory IDs, none added/removed |
| Git diff / protected file hashes | No protected engine/verifier/reader/provider/quota/dependency/fixture changes; materializer body unchanged |

The 21 added tests explain the increase from 526 pre-existing tests to 547 passing tests
on the final configured run. Eight native disposable PostgreSQL cases remain skipped
because their configured Windows PostgreSQL binaries are unavailable. PGlite-backed tests
in the ordinary suite passed; no hosted/native PostgreSQL execution is claimed.

The initial bounded extraction failure is retained, not erased by the successful rerun.
It is an intermittent local extraction reliability limitation; no retry was added to the
application and no verifier requirement was relaxed. The separate standalone XLSX
`WORKBOOK_CONTENT` / `u8 is not defined` investigation remains open; the passing test above
uses the supported configured Vitest harness, not proof of a standalone-runtime repair.

## Credential-free corpus measurements

| Corpus | Before | After | Meaning |
| --- | --- | --- | --- |
| Eight frozen original holdout documents | 87/87 exact fields; 15/15 exact rows | 87/87; 15/15 | Includes CSV, XLSX, digital/scanned PDF, PNG/JPEG; h01 is now seen development evidence |
| Existing 26-document regression | 242/276 exact fields; 41/48 exact rows | 242/276; 41/48 | Deliberately degraded/unsupported documents remain visible |
| Original failed live proposal replay | Null conventions, incorrect context | Still blocked: UNRESOLVED_CONVENTIONS; two unresolved rows | RECORDED_TEST replay, not a new model request |
| Complete supported verifier controls | Existing verified controls | New exact-value controls pass; existing eight-document controls retain 12 accepted / 3 unresolved | Deterministic acceptance tests, not model accuracy |
| New genuine inference / tokens / estimated spending | — | **0 / 0 / US$0** | Genuine model accuracy, inference latency and token improvement are unmeasured |

The eight-document before evaluation was executed on the original prompt during this task.
The 26-document before report is the preserved pre-change
`evaluation-regression-no-inference-1793022643505.json`; it was not rerun on 27 October.
The final after evaluations processed all 8 and all 26 cases with dispatch disabled.
Corrupt PDF still reports PROCESSING_FAILED; low-resolution/rotated receipts and unsupported
bank movements/invoices retain their original extraction or financial limitations.

Summed per-document runtimes: eight-document before 91,192 ms / after 29,964 ms;
26-document preserved before 68,108 ms / after 67,775 ms. These are single local measurements
with different cache/load conditions (a concurrent build was present during an earlier regression
measurement), not evidence that prompt refinement speeds/slows extraction or live inference.

The refined h01 conservative request reservation is **7,945 tokens including the 1,600
output cap** (UTF-8 byte bound, not tokenizer usage). All eight original-holdout requests
fit 8,000 TPM. Six regression requests remain too large: bank-narrative CSV 8,198,
bank-narrative XLSX 8,209, metadata CSV 8,017, metadata XLSX 8,028, mixed-bank PDF 8,524,
scan-bank PDF 8,524. They would be blocked
before dispatch. Source evidence is not truncated and quotas were not raised. Their
offline extraction can still be evaluated. Account access, effective future quotas and
acceptance of the refined strict schema require a separately authorized live test.

## Preservation and review evidence

Before editing, the tracked source was archived and all 179 first-experiment files plus
258 existing private local-state files were independently copied/hash-verified into the
private `snapshots/Increment03B-before-2026-10-27` recovery snapshot. Existing files remained
unchanged after verification; new credential-free runs were appended under ignored local
state. The original first-experiment ZIP and quota ledger hashes remain unchanged.

The independent review package contains complete before/after request messages/schemas,
focused source/tests, the frozen failed proposal, measured corpus reports, command logs,
screenshots, source hashes, scoped Git metadata and privacy exclusions. It excludes private
local state/credentials, recovery snapshots, dependencies, model assets, historical ZIPs,
the complete 6,000-row workbook and its full oracle.

Detailed numeric results are in [the measured summary](evidence/refinement-03b.json).
The full local evidence folder is `evidence/increment-03b-2026-10-27` under the canonical
FinGence root. Intentional local-server shutdowns have exit 143 in command records; these
are teardown, not failed build or acceptance checks. Temporary browser tabs/servers were closed.

No production-main merge or deployment is authorized by this feature publication. The
second-experiment protocol is prepared only; the first request's authority remains consumed.
