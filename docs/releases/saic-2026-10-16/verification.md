# Executed release-candidate verification — 15 October 2026

Environment: macOS Apple Silicon, official checksum-verified Node `v24.22.0`, pnpm `11.19.0`. Existing Vercel project is configured for Node `24.x`. No production database credentials are needed for the verified application.

| Executed command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; integrated lockfile accepted |
| `pnpm test` | Exit 0; **412 passed, 9 skipped**; 28 files passed, 2 files skipped |
| `pnpm test --reporter=json --outputFile=…` | Exit 0; same 412 passed, 9 skipped; machine-readable counts inspected |
| `pnpm lint` | Exit 0; no errors or warnings after removing one obsolete suppression comment |
| `pnpm exec next typegen` | Exit 0; route types generated |
| `pnpm exec tsc --noEmit --incremental false` | Exit 0 |
| `pnpm check:server-boundary` | Exit 0; real `server-only` import rejects default/client condition and accepts trusted server condition |
| `node supabase/tests/verify-local.mjs` | Exit 0; exact decimals/IDs/dates, warning relations, rollback negatives, RLS/client denial, 23 exported accepted rows and 11 indexes verified |
| `node supabase/tests/verify-upgraded.mjs` | Exit 0; historical rows preserved, clean/upgrade equivalence, 58 columns, 11 indexes, 5 triggers |
| `node tests/persistence/schema-compatibility.mjs` | Exit 0; original/upgraded/clean schema semantics verified |
| `pnpm demo:persistence` | Exit 0; 1 test passed; actual disposable DB counts below |
| `pnpm build` | Exit 0; 13/13 static pages generated |
| `pnpm audit --json` | Exit 1; **0 critical / 6 high / 5 moderate / 1 low**; exact same severities/findings as the unchanged personal checkpoint |

The 9 skips are explicit: eight native PostgreSQL concurrency tests require Windows PostgreSQL test binaries unavailable here; one optional supplied-workbook test requires `FINSIGHT_WORKBOOK_PATH`. The earlier 6,000-row workbook was not found at the approved course path or by a focused filename search; it was not substituted or regenerated. Native PostgreSQL tests were **not** executed. PGlite schema/transaction integration and the pg wire-protocol/lost-COMMIT tests **were** executed.

## Test groups

| Group | Passed | Skipped |
| --- | ---: | ---: |
| analytics | 25 | 0 |
| ingestion | 168 | 1 |
| cross-module | 6 | 0 |
| persistence | 201 | 8 |
| security | 12 | 0 |

## Independent correctness evidence

- Before repair, all four real-producer C1→analytics tests failed because the old adapter required nonexistent dataset-level versions. They pass with the actual producer type and payload.
- Before repair, four new transaction cleanup tests failed while 20 original adapter tests passed. All 24 now pass, preserving an acknowledged receipt, unknown COMMIT, uncertain rollback and definite transaction failure when release also throws; no retry is introduced.
- The even-sized median test independently specifies median 35 and MAD 15 for `[10,20,30,40,50,60]`. Old arithmetic produced two false positives; corrected exact arithmetic yields none.
- Independent Python Decimal arithmetic for the consultation samples gives ledger median `80.125`, MAD `51.925`; bank median `107.8`, MAD `83.725`. Exactly the two source amounts 1500 exceed threshold 4.5. Browser and TypeScript results agree.
- C3-I0 guards and direct SHA-256 checks confirm the protected engine modules, C1/C2 source and original fixture bytes are unchanged. No newline normalization occurred.
- The reduced C1 payload is not passed to the full-evidence grouped persistence validator.

## Actual local grouped-persistence output

```text
Persistence attempts:       1
Child batches:              3
Rows received:             26
VALID:                     20
WARNING:                    3
REJECTED count:              3
Accepted financial records:23
Accepted warning issues:    3
Rejected financial records: 0
```

All counts were queried from disposable PGlite after one transaction; child filenames and producer batch IDs matched the real fixtures. Existing grouped tests cover rollback, COMPLETED_EMPTY, duplicate-attempt rejection and uncertain-COMMIT investigation. No hosted database was migrated or written.

## Browser rehearsal

Production build on localhost, Edge:

- Desktop 1440×900; mobile 390×844 and 320×750; no document-level horizontal overflow.
- Branding/logo loaded, title `FinGence · Financial Intelligence`; icon/Apple assets retained.
- Ledger CSV, explicit bank Transactions worksheet, manual Details→Reference correction, approval gate, edge-case classification all exercised.
- Live counts: 26 received, 23 C1 accepted, 20 VALID, 3 WARNING, 3 rejected, 23 analyzed. Excluding WARNING changed only analytics to 20.
- Rejected source row 7 shows `31/31/2026`, no date substitution, original values, excluded preview and full technical evidence. Escape/Tab drawer interaction checked.
- Fresh reprocessing changed batch context without changing 23 accepted rows. Duplicate reload reused existing context. A setting change immediately removed edge results and analytics fell to 18; reapproval/recheck restored 23.
- All three actual browser downloads inspected on disk: 23 canonical CSV rows, four excluded problems across three rows, JSON with 26 evidence rows and 23 normalized rows.
- Overview, Transactions, Reconciliation, Analytics, Forecasting, Anomalies and Reports render with the explicit illustrative-page notice. No uncaught console errors were observed.
- Automated OS file selection was blocked by the Edge extension's missing file-URL permission. Sample-file loading uses the real CSV/XLSX reader and succeeded. Do not claim the OS picker upload was independently completed by automation.

Screenshots in `evidence/` contain controlled synthetic data only. Public Vercel preview/production verification is recorded separately after publication; localhost verification does not prove deployment.

## Dependency findings and scope

Current and unchanged-checkpoint audits both report 6 high, 5 moderate and 1 low, with no critical findings. Packages: brace-expansion, braces, source-map-js, optional sharp and Next.js. The Next Image Optimization SSRF advisory explicitly states apps without `images.remotePatterns` are not affected; this app configures none and uses static unoptimized branding images. Other published findings remain a separate dependency/security backlog. No zero-vulnerability or production-security claim is made.

Added runtime dependencies are pg `8.23.1` and server-only `0.0.1`; added development dependencies are PGlite `0.5.8`, PGlite socket `0.2.11`, and @types/pg `8.23.1`, matching the backend's pinned versions. Existing application dependency versions are retained. CI emits the audit report visibly as a non-blocking backlog step; mandatory tests, lint, types, boundary checks and build must pass.

## Ubuntu CI harness repair

The first remote runs on candidate `d7442f1` exposed a socket-test lifecycle race: a destroyed client had not always closed at the single-connection PGlite server before the next test connected, producing DATABASE_UNAVAILABLE before the intended failure injection. The repository wire-protocol tests now close their pool between tests and await the server-reported zero active connections before starting the next case. No assertion was weakened, no test removed, and no production write retry or connection policy was introduced. The original failed runs remain visible in GitHub Actions; subsequent candidate checks must pass before merge.
