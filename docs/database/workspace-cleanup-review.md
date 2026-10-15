# Backend-only workspace cleanup plan

4 October 2026. This replaces the earlier conservative frontend-preserving cleanup plan. Written before this second deletion pass. No commit/push or hosted database changes are authorized.

## Analysis and scope

The backend directly imports ingestion models (types) and normalizer (runtime). Persistence fixtures import the public index, whose exports reach all 12 engine modules. Keep these unchanged; no imports are rewritten. Production parsing still requires papaparse, read-excel-file/universal and fflate. Keep seven ingestion tests for models, exact money/date normalization, readers/buffer ownership, mapping, pipeline/consolidation, workbook safety and accepted/rejected export semantics. Remove the standalone handoff-recipe suite (13 tests, including the known CRLF/LF evidence comparison) and optional external-workbook test: neither exercises the persistence service; all persistence tests and producer regressions remain. This is a scope reduction, not a repair of the old handoff failure.

No backend, retained tests or database tools import app/components, mock types/formatters/data, Next/React/Tailwind/lucide. The application routes and navigation may now be intentionally removed. public/samples/ingestion holds four genuine test fixtures and remains without HTTP serving. Ingestion reference documentation, UI evidence and the consumer recipe may be removed from FYP because Chia Data preserves them.

Keep all lib/server, tests/persistence and supabase files unchanged. Keep original docs/database Phase 1/2 documents as historical implementation records. Retain CLAUDE.md as the agent entry redirect. Update AGENTS.md and README for this backend scope. Remove Next config, PostCSS, generated next-env.d.ts and .next after resolving/validating absolute target containment. Remove Next/React packages/types, Tailwind/PostCSS, lucide and eslint-config-next. Keep TypeScript/Vitest/ESLint; add direct standalone typescript-eslint, @eslint/js and globals using the existing lockfile versions. Remove Next JSX/plugin/alias/generated type includes; retain DOM library types for the shared ingestion reader Web APIs, plus Node types. Do not add a production build/deployment contract.

server-only stays unchanged with its conditional exports: default imports throw; trusted Node ESM uses --conditions=react-server. Tests continue mocking only the marker as already implemented. Add a tool-level smoke check of actual marker resolution without accessing database credentials.

Remove pnpm-workspace.yaml: this is a single-package project and its only entries deny builds for sharp/unrs-resolver, neither of which remains in the backend lockfile. Keep secret/generated ignores. Remove obsolete frontend scripts; add typecheck and ingestion-test scripts. No retained Chia implementation is modified. Retain the original local Phase 1 verification script/runtime as existing backend tooling; do not replace its pinned runtime in this cleanup.

## Exact original tracked files to remove

```text
app/analytics/page.tsx
app/anomalies/page.tsx
app/data/page.tsx
app/favicon.ico
app/forecasting/page.tsx
app/globals.css
app/layout.tsx
app/page.tsx
app/reconciliation/page.tsx
app/reports/page.tsx
app/transactions/page.tsx
components/app-shell.tsx
components/charts.tsx
components/ingestion/mapping-editor.tsx
components/ingestion/profile-view.tsx
components/ingestion/results-view.tsx
components/overlay.tsx
components/report-preview.tsx
components/ui.tsx
docs/design-concepts/overview-desktop.png
docs/design-concepts/overview-mobile.png
docs/design-concepts/reconciliation-desktop.png
docs/handoff/AI_CONTEXT.md
docs/handoff/TEAM_HANDOFF.md
docs/ingestion/architecture.md
docs/ingestion/demo.md
docs/ingestion/evidence/quarantine.png
docs/ingestion/evidence/summary.png
docs/ingestion/verification.md
examples/ingestion/consume.ts
lib/formatters.ts
lib/mock-data.ts
lib/types.ts
next.config.ts
postcss.config.mjs
pnpm-workspace.yaml
public/file.svg
public/globe.svg
public/next.svg
public/vercel.svg
public/window.svg
tests/ingestion/handoff.test.ts
tests/ingestion/supplied-workbook.test.ts
```

## Exact original tracked files to retain

```text
docs/handoff/examples/ingestion-evidence.json
.gitignore
AGENTS.md
CLAUDE.md
README.md
docs/database/initial-ingestion-foundation.md
docs/database/phase-2-internal-persistence.md
docs/database/phase-2-persistence-design.md
eslint.config.mjs
lib/ingestion/exports.ts
lib/ingestion/index.ts
lib/ingestion/mapper.ts
lib/ingestion/models.ts
lib/ingestion/normalize-record.ts
lib/ingestion/normalizer.ts
lib/ingestion/pipeline.ts
lib/ingestion/profiler.ts
lib/ingestion/readers.ts
lib/ingestion/summary.ts
lib/ingestion/validator.ts
lib/ingestion/workbook-guard.ts
lib/server/db/postgres.ts
lib/server/persistence/contracts.ts
lib/server/persistence/map.ts
lib/server/persistence/repository.ts
lib/server/persistence/service.ts
lib/server/persistence/validate.ts
package.json
pnpm-lock.yaml
public/samples/ingestion/bank_statement.xlsx
public/samples/ingestion/edge_cases.csv
public/samples/ingestion/expected.json
public/samples/ingestion/ledger.csv
supabase/.gitignore
supabase/tests/fixtures/phase1-original-schema.sql
supabase/seed.sql
supabase/tests/verify-local.mjs
supabase/tests/verify_ingestion_foundation.sql
tests/ingestion/contract-regressions.test.ts
tests/ingestion/exports.test.ts
tests/ingestion/normalizer.test.ts
tests/ingestion/pipeline.test.ts
tests/ingestion/readers-buffer.test.ts
tests/ingestion/readers-mapper.test.ts
tests/ingestion/xlsx-fixtures.test.ts
tests/persistence/fixtures.ts
tests/persistence/map.test.ts
tests/persistence/postgres.test.ts
tests/persistence/repository.integration.test.ts
tests/persistence/repository.test.ts
tests/persistence/schema-compatibility.mjs
tests/persistence/service.test.ts
tests/persistence/validate.test.ts
tests/persistence/verify-hosted-compatibility.sql
tsconfig.json
vitest.config.mts
```

Changes among retained files: package.json, pnpm-lock.yaml, tsconfig.json, eslint.config.mjs, AGENTS.md, README.md. Add only this cleanup report and backend boundary checker. Generated removal: .next/ and next-env.d.ts. node_modules remains ignored and is synchronized by pnpm install. Original Phase 1/2 source, migration/seed, persistence tests, retained Chia code/tests and fixture bytes must remain identical.

## Existing reference/backup

Chia Data and Cleanup Backup are outside FYP and must not be changed. The existing backup contains every original tracked removal candidate. Their manifests will be used read-only for final integrity checks; no new backup or reference content is written.

## Verification

Completed results are recorded below: frozen installation, server guard, typecheck, lint, all applicable tests, original-source hashes and Git scope.

## Dependency correction discovered during additional Phase 1 verification

The unchanged supabase/tests/verify-local.mjs reads docs/handoff/examples/ingestion-evidence.json to exercise all 23 accepted producer records and ordered warnings against the schema. This synthetic fixture was restored byte-for-byte from the existing backup and is retained at its original path. Its directory now holds only test data, not reference documentation. The exact deletion set is therefore 43 original tracked files, with 56 original tracked files retained. The initial extra verifier run passed migration, repeat seed, SQL assertions and RLS checks, then exposed the missing fixture; after restoration it passed in full. No verifier/source behavior was changed.



## Completed verification and final state

- Full applicable Vitest suite: **216 passed across 13 test files**, no failures or skips. Includes Phase 2A 83, Phase 2B/2C unit 31, real local PostgreSQL integration 17 and retained ingestion compatibility 85. Every original persistence test remains unchanged. The former 13-test recipe suite and one optional workbook test are explicitly removed from this backend scope; the old CRLF/LF fixture comparison was not repaired or suppressed in a retained suite.
- TypeScript passed with simplified backend-only includes and Node types.
- Standalone lint passed with zero errors and one existing `no-unsafe-finally` warning in postgres.ts: release failure can override an earlier result/error. Approved backend behavior is unchanged; any correction belongs to a separate reviewed backend change. File-specific regex exceptions preserve intentional reader controls/ZIP signatures and unchanged Chia fixture syntax.
- Real server-only resolution check passed: all three privileged modules retain the marker, ordinary import is blocked, trusted Node condition succeeds without React/Next. Its initial sandbox run could not spawn Node; the permitted child-process run passed.
- pnpm offline install removed 234 packages. Frozen offline install verified manifest/lockfile/installed consistency with 16 direct dependencies; runtime/parser/database/test versions remain the existing locked versions. Direct standalone lint tooling replaces Next's lint bundle. No dependency upgrade is part of this cleanup.
- Additional unchanged Phase 1 local verifier passed migration, repeat synthetic seed, SQL negative assertions, RLS/client denial, 23 accepted fixture records/ordered issues/exact decimals and 11 indexes after restoring its required evidence fixture. Only disposable local test databases were used.
- Hash verification confirmed all 50 retained original files outside the six authorized tooling/documentation modifications are byte-identical, including original backend, migration/seed, persistence tests, retained ingestion code/tests/fixtures and original database documentation remain unchanged. All 99 backup and 55 reference copies retain their original hashes. No writes occurred in either sibling directory.
- No retained backend/test import references removed frontend modules. No Next, React, lucide, Tailwind, sharp or unrs-resolver packages remain in the resolved lockfile.
- Git diff consists of **43 original tracked deletions**, **6 tracked modifications** (AGENTS, README, ESLint, package, lockfile, TypeScript) and **2 new files** (this report and the boundary checker). Generated .next and next-env.d.ts were removed; ignored node_modules remains synchronized. Nothing is staged. HEAD remains ebacdee0f80f7e4a8a718db2536a91dbe2009e12 on feature/database-ingestion-foundation, personal origin https://github.com/jiaqi538/FYP.git.

## Remaining intentional dependencies

`public/` is only four test fixtures, not frontend infrastructure. `docs/handoff/` is only the Phase 1 verifier fixture. `exports.ts` remains because the unchanged public engine barrel exports it, and its tests verify accepted/rejected evidence semantics. The separate ignored `supabase/.verification-runtime` remains for the unchanged pinned Phase 1 tool. DOM TypeScript libraries support the original shared reader's web-standard APIs and do not install browser/React code. Historical backend documents describe the former app as inspection context; they are not instructions to restore it. The unused frontend cache/package files that a package manager may retain internally are reinstallable local state, not committed source.

Forbidden sibling repository never accessed or modified. Chia Data and Cleanup Backup unchanged. Supabase/hosted database/schema unchanged. Retained Chia implementation unchanged. No real financial data or real credentials used, added or exposed. No commit or push.
