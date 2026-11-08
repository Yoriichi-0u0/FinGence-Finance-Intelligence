# Increment 02 executed verification

20 October 2026; local macOS arm64; Node 24.22.0, pnpm 11.19.0, Python 3.12.14.
Implemented and internally reviewed; independent review package prepared separately.
**No live model used. RECORDED_TEST only.** Existing historical verification is untouched.

## Commands actually executed

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; dependency manifest/lock unchanged from Increment 01 |
| `pnpm test` (final, including positive PNG/JPEG controls) | Exit 0; **492 passed, 9 skipped (501)**; **39 files passed, 2 skipped (41)** |
| `pnpm lint` | Exit 0; no warnings |
| `pnpm typecheck` | Exit 0; Next type generation and `tsc --noEmit --incremental false` |
| `pnpm check:server-boundary` | Exit 0; original server module guards/import restrictions pass |
| `pnpm build` | Exit 0; Next 16.3.6 production build, including new dynamic developer routes |
| `pnpm audit --json` | Exit 1; 0 critical, 6 high, 5 moderate, 1 low; existing dependency graph unchanged |
| `.venv-ai/bin/python -m pip check` | Exit 0; no broken requirements |
| `git diff --check` | Exit 0 |
| `node --conditions=react-server scripts/ai-increment-02.mjs evaluate` | Exit 0; actual extraction/verification over 26 documents; no unexpected failures |

Forty new Vitest tests protect semantics, reuse, replay/route boundaries, exact fixture
bytes, context retention, and actual positive PNG/JPEG extraction through the 0.2 verifier.
All prior tests remain unchanged. The nine skipped tests are eight native Windows
PostgreSQL-binary tests and the optional 6,000-row workbook test without its environment
path. Disposable PGlite integration tests ran; no hosted database was accessed. This is
not a claim that native PostgreSQL or the optional workbook ran this increment.

The audit advisories cover brace-expansion, braces, source-map-js, optional sharp and
Next.js. This task made no dependency change and no remediation claim. Some paths are
runtime-related; they are not all development-only. See the complete [audit JSON](evidence/audit.json).

## Actual recorded-test evaluation

The 26 files are controlled representations, not 26 independent financial datasets.
Several contain the same transactions in different formats. Exact labels were authored
separately under `tests/fixtures/ai-ingestion-02/`; runtime proposal construction, the
verifier, provider request preparation and replay do not import those labels.

| Metric | Measured result |
| --- | ---: |
| Accepted row representations | 27 |
| Rejected rows (known malformed financial values) | 2 |
| Unresolved observed rows | 14 |
| Supported expected accepted rows matched exactly | 27 / 27 |
| Observed false acceptance / false rejection | 0 / 0 |
| Exact extracted source fields, including blanks | 242 / 276 (87.68%) |
| Recorded proposal field-role agreement | 120 / 138 (86.96%) |
| Unexpected extraction failures | 0 |
| Deliberate corrupt PDF failure | 1 |
| Documents with unestablished row structure | 3 |
| Reuse trials | 2 safe reuses; 2 require reinterpretation |
| Sum of per-document extraction/replay durations | 91,609 ms |
| Live requests / tokens / estimated API spending | 0 / 0 / US$0 |
| LLM proposal accuracy | NOT MEASURED |

These field metrics include intentionally degraded and unsupported cases. They measure
exact source strings/recorded-policy behavior, not general OCR accuracy or LLM quality.
The acceptance metric tests only this small controlled corpus. Internal review found
additional counterexamples outside the corpus; those became regressions and were fixed.

Observed limitations and failures are retained in the [machine-readable evaluation](evidence/evaluation.json):

- The rotated receipt photo and degraded PNG/JPEG produced no reliable table structure.
  Their row counts remain unestablished, not zero actual records. They are document-level
  unresolved cases, additional to the 14 observed unresolved rows.
- The deliberately corrupt PDF fails extraction and accepts nothing.
- Scanned/mixed PDFs match all financial labels but each misses one exact empty reference
  cell in the extraction metric (20/21 fields). The omission is reported, not removed
  from the denominator. It does not license acceptance of missing required values.
- Bank movement pairs, invoices/receipts, unknown fees and ambiguous conventions are held.
- `validation-errors.csv` yields exactly 1 accepted / 2 rejected / 1 unresolved.
- Large exact decimals, leading zeros and distinct source dates are preserved.
- Positive PNG/JPEG controls additionally reuse the untouched Increment 01 statement
  images: each returns two exact accepted records through the new verifier. These are
  regression controls and are not added to the 26-file metric denominator.

Reuse trials: bank narrative → new precision CSV (1 accepted); ledger CSV → XLSX
(2 accepted); new unknown fee and bank movement structures → reinterpretation, 0 accepted.

## Review defects reproduced and repaired

An isolated fresh-context reviewer found two source-loss defects. Both had failing tests
before implementation fixes and a passing bounded recheck:

1. A short financial-word blacklist allowed Commission RM 50.00, Paid JPY 5000 and
   Additional payment 50.00 to be excluded as notes. Six new negative tests failed before
   the fix; exclusions now require positive, rule-specific administrative values.
2. PDF text inside an outer table rectangle was suppressed even when absent from all
   emitted cells. A deterministic stubbed converter probe reproduced the loss. The fix
   retains unrepresented text and deduplicates only matching literal text/cell geometry.
   This stub is an adapter-boundary regression, not an OCR benchmark.

Typed value/text disagreement, malformed schemas, changed literals, missing rows,
invented rules, bank/ledger swaps, unsupported direction, unknown values, frozen-input
purity and rebind invalidation are also tested. No acceptance rules were weakened.

## Browser and built-production checks

Real local browser interaction exercised CSV, XLSX, digital/scanned/mixed PDF, PNG/JPEG,
warnings, partial validation, unresolved bank movements, deliberate swaps/omissions,
successful fresh-value reuse, native keyboard disclosure and an actual JSON download.
The downloaded precision report retains RECORDED_TEST, NOT_EXECUTED and
`9007199254740993.01`. Widths 1440, 768, 390 and 320 had no document-level horizontal
overflow. No browser console error or application runtime error was observed during
the completed rehearsal. Practical checks do not establish complete accessibility.

The ordinary finance page has no developer replay selector; its CSV run executes
extraction, then blocks inference/synthesis/verification/acceptance. Posting
`mode=RECORDED_TEST` to its API does not activate replay. Original finance UI/route code
remains unchanged.

An actual `next start` build on loopback port 3106, with local/replay flags enabled,
returned 404 for the developer page and GET/POST API. The original finance API returned
403 in production. Its unchanged page shell returns 200 but cannot process through the
blocked API; no production deployment was made. Development mode without its flag,
cross-origin requests, arbitrary paths/blueprints, missing explicit header and oversized
requests are separately rejected in route tests.

Screenshots: [desktop](evidence/01-recorded-csv-desktop.png),
[partial financial validation](evidence/02-partial-validation.png),
[bank movement hold](evidence/03-bank-movements-held.png),
[mobile reuse controls](evidence/04-reuse-mobile.png),
[finance inference blocked](evidence/05-finance-live-blocked.png).

## Preservation and rollback

The external snapshot was completed before edits: 212 source files, CRC and individual
SHA-256 verification. All 212 remain byte-identical after Increment 02; all new increment
paths are additive. The original Increment 01 ZIP remains 5,635,458 bytes with SHA-256
`545191055342366b7d319e5e9d45caf9c016fa7ffb98fe9aeae44dd120bccd45`.

Snapshot ZIP SHA-256:
`8fac24d4107e6e49df65099cbecfec96b747caa96dd9b7cdc24d70bc5d2612d1`.
Existing dirty Increment 01 work remains separate from this new-file increment.
The snapshot's manifest and new changed-file manifest provide the rollback boundary:
stop only this increment's launcher, archive its new paths if needed, and restore the
captured source after explicit authorization. Do not use a broad reset/clean or touch the
protected stash to roll back.

Original worktrees remain clean at c32216e (personal historical checkpoint), 161b489
(linked team worktree) and da10e2f (released personal main worktree). Protected stash
`1aa97d83500cab7055d1d8dda0b3fe727ae11556` remains unapplied; the three external sample
backup hashes match their original preservation manifest. No tags, branches, remote
heads, main trees or FinGence 1.0 production were modified.

The next milestone is genuine bounded LLM inference using this evidence/blueprint
boundary, independent model-rule evaluation and a reviewed finance-flow connection.
Credential setup, provider dispatch, model results and downstream conversion are not
implemented or implied by this increment.
