# AI01–AI05 research publication — 31 October 2026

This Draft PR is stacked on `feature/backend-api-celester` at `9385da7f4bb5ef9abbf2dec39b31e60e639fcaca`. Its changes contain research code, synthetic fixtures/evaluation-only labels, tests, frozen evidence and documentation only. Existing DB03 local modifications and demonstration evidence are excluded. DB01–DB03, DB04 documentation and teammate work are preserved. This is not production accounting approval or an integration/API release.

## Results retained without rerunning the official experiment

Training/development before verification: E0 TP28/FP0, E1 TP32/FP0, E5 TP34/FP4. The reviewed verifier retains 18 genuine suggestions per method and withholds all eight known E5 risks, including its two additional genuine matches.

Official held-out population: 100 synthetic rows, four unseen schemas, 32 genuine pairs. E0 TP14/FP0, E1 TP16/FP0, E5 TP18/FP2 before verification. After verification the **same eight genuine pairs** remain for every method: 100% observed assessed precision, 25% recall, 40% F1 and 16% bank coverage. E5 provides **no final verified matching advantage** under the present conservative policy. Small authored synthetic samples cannot establish production accuracy or statistical significance. Grouping, partial payments, FX, automatic confirmation and posting are unsupported.

## Integrity and Windows/Git line endings

The original phase source, fixtures, measurements, manifests and AI05 seals are not edited. Raw benchmark/evaluation JSON and other evidence remain byte-exact. Existing `.gitattributes` preserve those artifact bytes in Git; source hashes retain their documented CRLF-to-LF normalization rule.

Git's default staged whitespace check flags preserved CRLF artifact terminators as trailing whitespace. The publication check recognizes CR as part of the line terminator through a command-local setting, while still checking trailing spaces/tabs, blank EOF lines and space-before-tab errors. The existing attribute files are themselves frozen inputs and remain unchanged. No artifact bytes, repository-wide whitespace setting or historical metadata are changed.

```powershell
git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check
```

Seven historical hash references capture Windows CRLF checkouts of four **existing backend source/configuration files**: package.json, tsconfig.json, pnpm-lock.yaml and scripts/db03/vitest.config.mts. Git already stores their LF forms on the backend base. The exact scope is two references each in AI02/AI03 and three in the AI05 freeze. The publication verifier independently checks that inserting CR before each Git LF reproduces the *entire original recorded SHA-256*. It does not ignore mismatches, alter frozen hashes or apply this rule to raw datasets, predictions, measurements or arbitrary files. Changes to any other content fail verification. Six regression tests protect this boundary.

From the existing repository:

```powershell
# Read staged Git objects before commit:
node scripts/ai-research/verify-publication.mjs INDEX
# Read actual published commit objects after commit/checkout:
node scripts/ai-research/verify-publication.mjs HEAD
```

This read-only audit needs Node and Git, not model weights, hosted access or local checkout line-ending assumptions. It verifies all phase manifests, original freeze and prediction/evaluation seals against Git blobs. The original working-copy verifiers remain available for the captured Windows environment. Their local model paths/hardware and historical byte-exact checkout captures should not be mistaken for a portable command to rerun the one-shot official experiment on a different machine.

## Research verification and prerequisites

`verification.json` records fresh publication checks and distinguishes them from retained historical results. `files.txt` lists the exact published paths. One-shot AI05 prediction/evaluation stages and historical AI03 evidence-writing inference are disabled during ordinary regression verification; their actual successful evidence remains committed. Do not overwrite or retune the official experiment.

The local research suite uses the existing project dependencies and approved pinned E5 runtime outside Git. Some configuration/integrity tests require that local runtime even when they perform no inference. No runtime installation or weight download was performed for publication. A teammate/CI environment without those prerequisites must report unavailable checks honestly, rather than claiming these local results as its own. The Git-blob audit above can verify retained artifacts without installing E5.

DB04/AI06 still require approved producer V2 eligibility, immutable source identity/revision and provenance, account-scoping/monetary/date conventions, counterparty/reference authority, suggestion approval/lifecycle/audit/idempotency and security contracts. No database persistence, HTTP/API, hosted Supabase, model retraining or UI implementation is included. PR #2 and PR #35 are not modified; this PR targets the backend branch only. UI/UX Issue #39 remains separate work on a clone/branch based on PR #35.
