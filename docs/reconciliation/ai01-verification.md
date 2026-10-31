# AI01 M1 engineering report

27 October 2026 (Asia/Singapore). **Completed locally; ready for review.** No matching algorithms, model inference, database integration, publication or expansion beyond M1 were implemented.

## Repository state and protection

Initial AI01 implementation HEAD: `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca`, originally clean. At the start of this independent-review correction, all 21 AI01 files were untracked and the workspace also contained a pre-existing scripts/db03/run.mjs modification and three untracked DB03 demonstration evidence directories (12-52-50, 12-55-58 and 13-09-48 UTC). Their contents were fingerprinted and preserved without modification. Actual local branch remains `feature/backend-celester`, tracking `origin/feature/backend-api-celester`. No switch/rename occurred and HEAD remains unchanged.

Read AGENTS.md and docs/handoff/AI_CONTEXT.md, the financial models and existing decimal/persistence validation, package scripts, TypeScript and Vitest configuration. There were no research/reconciliation/, tests/reconciliation/ or docs/reconciliation/ files initially, so no AI00 document was overwritten. Final changes are only new files in these three directories. No existing tracked application, API, ingestion, security, analytics, frontend, database, migration, infrastructure or DB01–DB03 file changed. No existing test configuration or dependency manifest was modified.

The ignored 258 preliminary DB01 artifacts and their local exclusion rule are preserved. Historical DB01/DB02 artifacts are checked using exact Git blobs by the existing safety suite. The DB03 working-tree source manifest was not rerun or rewritten: its runner source hash predates the separately authorized branch-compatibility change already present at review start. The full DB01 benchmark and DB03 recovery drill were not rerun. The previous architecture assessment remains absent, as observed during DB03; no file was recreated or discarded.

## Independent review findings and corrections

**Finding 1 reproduced:** deleting all explicit negatives, deleting each individual required edge, and changing a required AMOUNT reason to generic DISTINCT_EVENT all passed the old validator. The new independent pilot-annotations.ts manifest lists the minimum required edges/reasons by stable source row identity, resolving current IDs at validation. It does not import CASES or generate its expectations from submitted labels. Validation requires those exact annotations for M1 revision 1.0.1, allows an additional consistent sixth negative and rejects same-count substitution, contradiction and duplicate labels. Future datasets do not inherit a universal five-negative rule; unsupported revisions remain explicitly rejected by the current M1 validator.

**Finding 2 reproduced:** the recurring case had two distinct visible date signatures, allowing canonical-date equality to distinguish the authored pairings. All four recurring records now share transaction/posting/canonical date 2026-02-17, with null source transaction IDs. All permitted economic/text/date evidence is identical, so each bank record has two equally supported ledger candidates even with exact dates. Unique record/provenance identities remain intact and cannot authorize a cross-source tie-break. Author-known economics remains separate, with two true pairs and ABSTAIN_AMBIGUOUS outcomes. No matching algorithm was introduced.

The generator is revision ai01-m1/1.0.1. Its frozen 1.0.0 seed namespace preserves existing opaque IDs and exact monetary values; only revision metadata and recurring-case date/source-transaction availability change in the frozen dataset. The unchanged financial validator remains in force. Tests verify ambiguity across three seeds and reproducibility across the existing alternate seeds.

As a separate preservation check, reversing only those metadata/date/source-ID corrections in memory reproduces the original fixture's exact SHA-256 bb17c3ad16ee5b08c1f52f7824cab93d55e7b119b07f1fa5e47e637fbd9d4f6b. This confirms all other record fields, monetary strings, identities and ground truth stayed byte-equivalent under canonical serialization; the old fixture was not rewritten back to disk.

## Architecture and actual dataset

This is a research-only, dependency-free TypeScript module using Node's built-in SHA-256. Generator/domain-key hashes deterministically vary identifiers, references, descriptions and an exact amount offset. Every record retains opaque identity, source system/template/account identity and synthetic row provenance. Financial interpretation is explicit per source. A separately authored scenario board supplies economic truth before record rendering; an independent validator checks shape, finance, dates, lineage and labels without calling the generator or a matching algorithm.

| Quantity | Actual count |
| --- | ---: |
| Rows | 40 |
| BANK / LEDGER | 20 / 20 |
| Source templates | 4 (10 rows each) |
| True one-to-one economic pairs | 14 |
| Explicit negative pairs | 5 |
| Economically unmatched records | 9 |
| Ambiguous cases | 2 |
| Unsupported grouped relationships | 1 (two bank instalments, one ledger entry) |
| Provisional pair suggestions | 10 |

Fourteen true pairs account for 28 rows; the group adds three and unmatched records add nine. Ambiguity spans seven existing rows and includes three latent true pairs; missing-reference abstention covers one further true pair. Five negatives are edges, not additional records. Case families A–J and their exact distribution are in [the specification](ai01-dataset-spec.md).

Economics and operational decisions are distinct: recurring/duplicate candidates abstain even when the author knows the true counterpart; missing-reference evidence also abstains. The grouped event stays UNRESOLVED_GROUP rather than becoming two false one-to-one matches. SUGGEST_PAIR is a research proposal, never authorized reconciliation. Unannotated Cartesian edges remain unannotated, not verified negatives. See [the annotation guide](annotation-guide.md).

## Financial integrity and determinism

Decimal strings retain source precision and exact very large monetary values; comparisons/group sums use BigInt-scaled integers. No monetary Number arithmetic, FX conversion, implicit tolerance or rounding exists. Source signed amounts, cash-asset debit/credit and restricted expense/refund debit/credit views retain distinct conventions. Unavailable monetary sides, references, counterparties, source transaction IDs and dates stay null. Available transaction and posting dates can differ; canonical date must equal the template-selected date, with calendar checks. Identity, source coordinates and economic-use uniqueness are checked.

The seed, version, row count and source definitions are recorded in each dataset. Fixed-seed runs compare complete records, labels, canonical bytes and fingerprints. Alternate seeds remain valid and deterministic. Clock/random spies, negative mutations, exact arithmetic tests and a frozen fixture support this evidence. The frozen fixture is not claimed to be an independent annotation oracle.

Default fixture: research/reconciliation/fixtures/pilot-dataset.json, **53,008 bytes**, SHA-256 **6c5961572fc1b725f7129cec35810cbea77f8c560e70ed6f18d677a7094c7044**. Canonical serialization uses sorted object keys, intentional array order, UTF-8 and one final LF. Its source template and ordering are stable; no current-date/network dependency exists. The fixture-only attributes pin LF without changing any historical artifact rule.

## Executed verification

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/reconciliation --maxWorkers=1` (final run also adds JSON reporter/output) | 106 passed, 0 failed, 0 skipped; 3 files |
| `pnpm exec vitest run tests/reconciliation tests/api tests/persistence tests/integration/grouped-consultation.test.ts tests/recovery/db03.safety.test.ts --config scripts/db03/vitest.config.mts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/ai01-regressions.json` | 630 passed, 0 failed, 0 skipped; 24 files |
| `pnpm typecheck` | Passed: Next route type generation and full `tsc --noEmit --incremental false` |
| `pnpm exec eslint research/reconciliation tests/reconciliation` | Passed |
| `node scripts/db03/verify.mjs` | Not rerun for this correction; pre-existing runner change is outside AI01 scope |
| `git diff --check` and `git diff --cached --check` | Passed; only the pre-existing DB03 runner tracked diff; nothing staged |
| New-file whitespace/scope, evidence/source hashes, fixture canonical bytes and local Markdown links | Passed; recorded in evidence/checks.json and integrity-manifest.json |

The standalone JSON report is [ai01-tests.json](evidence/ai01-tests.json). The combined [ai01-regressions.json](evidence/ai01-regressions.json) includes those same 106 AI01 tests plus 514 existing API/persistence/grouped regressions and ten existing DB03 safety/history cases. These are **630 distinct selected tests**, not 736. Existing native PostgreSQL 18.6 coverage contributes 25 tests in a freshly initialized disposable local cluster. This does not make AI01 database-dependent or claim to rerun all recovery tests. Native server setup/cleanup is owned by the unchanged existing harness; no hosted/developer database is used.

The first ordinary sandbox Vitest attempt failed during transform-cache rename with Windows EPERM: three suites failed to load, **zero tests ran**. A subsequent run outside the restricted sandbox passed 90 tests. Explicit authoring runs created then updated only the new frozen snapshot (15 generator tests each). A preliminary combined run passed 615 tests; a final separate-date preservation test brings the final run to 616. Final normal-mode execution reads the frozen snapshot and does not regenerate it. No failing assertion was bypassed and no existing code was changed to satisfy tests. The existing DB03 Vitest configuration is reused for the combined run to disable dotenv loading; the standalone run uses the unchanged root configuration.

That paragraph records the original M1 history. For this correction, the pre-fix regression command `pnpm exec vitest run tests/reconciliation/ground-truth.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=docs/reconciliation/evidence/review-baseline.json` produced **8 expected failures and 8 passes**; [review-baseline.json](evidence/review-baseline.json) retains the defect proof. After implementation, explicit `--update` regenerated the fixture and 102 tests passed. Four further scope/substitution/multi-seed cases bring the final AI01 suite to 106 passing tests, with normal read-only snapshot verification. The final combined 630-test run supersedes the original 616-test result; the retained baseline failures are not counted as final failures or passes.

## Every new file and purpose

| File | Purpose |
| --- | --- |
| research/reconciliation/types.ts | Isolated research transaction/template/annotation types |
| research/reconciliation/schemas.ts | Four explicit synthetic source conventions |
| research/reconciliation/decimal.ts | Exact bounded money syntax and BigInt operations |
| research/reconciliation/ground-truth.ts | Authored economic scenarios and separate outcomes |
| research/reconciliation/generator.ts | Seed/config/version, records, canonical serialization, SHA-256 |
| research/reconciliation/validator.ts | Independent financial/date/identity/annotation validation and counts |
| research/reconciliation/pilot-annotations.ts | New independently reviewed M1 revision-specific required-edge manifest and completeness check |
| research/reconciliation/fixtures/pilot-expectations.json | Independently specified counts and family distribution |
| research/reconciliation/fixtures/pilot-dataset.json | Frozen canonical synthetic 40-row dataset plus sidecar labels |
| research/reconciliation/.gitattributes | LF-only rule for these new JSON fixtures |
| research/reconciliation/README.md | Use, boundary and controlled regeneration instructions |
| tests/reconciliation/generator.test.ts | 15 determinism/config/fixture tests |
| tests/reconciliation/ground-truth.test.ts | 20 annotation/completeness/contradiction/ambiguity/grouping tests |
| tests/reconciliation/validator.test.ts | 71 validation/negative mutation/calendar/exact-money tests |
| docs/reconciliation/ai01-dataset-spec.md | Source/scenario/count contract, future split and integration proposals |
| docs/reconciliation/annotation-guide.md | Annotation authority, sparse negatives and abstention rules |
| docs/reconciliation/ai01-verification.md | This complete engineering report |
| docs/reconciliation/.gitattributes | Byte-preservation rule for only the new evidence |
| docs/reconciliation/evidence/ai01-tests.json | Final standalone machine-readable Vitest results |
| docs/reconciliation/evidence/ai01-regressions.json | Final selected combined results |
| docs/reconciliation/evidence/checks.json | Command/check outcomes and preservation facts |
| docs/reconciliation/evidence/review-baseline.json | New pre-fix reproduction: eight failures/eight passes |
| docs/reconciliation/integrity-manifest.json | Byte-exact fixture/evidence hashes and LF-normalized source hashes |

## Outstanding decisions and readiness

**AI01 M1: Completed and ready for review.** The synthetic source conventions, economic annotation assumptions and provisional suggestion/abstention rules need review before any operational use. Validation demonstrates internal coherence, not client accounting correctness or algorithm quality. The tiny authored pilot and deterministic variants are not statistically independent model-evaluation samples. Public V2 ingestion approval remains undefined and no legacy ingestion status is treated as proof of verification.

Future work needs an approved candidate-input projection that excludes privileged labels and generator shortcuts, an independently reviewed larger scenario inventory, split governance, operational date/tolerance/grouping policy and future authorized-review semantics. The spec documents proposed DB04/AI06 information requirements without implementing them. No model recommendation is treated as a proven winner and no precision/recall/F1/accuracy is invented.

Recommended next **AI01 expansion** step: review and freeze the M1 conventions/annotations, design at least eight additional schemas (four reserved unseen), then approve a leakage-controlled 300+ row expansion with disjoint event groups/periods/identifier pools. Do not start expansion, AI02/AI03, DB04 or database integration automatically.

All 21 original AI01 files plus the two new files above form the complete **23-file review package**, with repository-relative paths preserved in the ZIP supplied alongside this report. The archive is outside the repository and contains no DB03 resources, dependencies, credentials or actual financial data. Archive entries are read back and byte-compared to the workspace files. Changed-file hashes and protected-file preservation are recorded in checks.json; artifact/source hashes are refreshed in integrity-manifest.json.

All 23 AI01 files remain local/untracked; nothing staged, committed, pushed, merged, deployed or changed in draft PR #2. No model download, AI provider, real financial document, production SQL or hosted Supabase access occurred. Existing dependencies and backend behavior remain unchanged. The pre-existing DB03 runner change and all three demonstration evidence directories remain untouched.
