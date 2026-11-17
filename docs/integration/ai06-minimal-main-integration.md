# Minimal AI06 saved-evidence integration on main

14 November 2026. Local branch: integration/ai06-gpt-suggestions-main-celester.
Base: origin/main 72731f2e7664c05210c03eee418b5fdd7c2c7261, freshly fetched. Source: 6a071e011523556a19e816e2a520bab935e67b88. No merge or cherry-pick performed.

## Scope

This is a saved-GPT-evidence website increment, not a port of the historical DB04 stack. Existing main authentication, processing, ingestion, reconciliation statement, multi-period totals, reporting, navigation, provider gateway, security and database implementations remain unchanged. Only three existing UI files have two additive lines each. The new panel appears immediately after the current reconciliation statement and before Every record, matched; main's current styling/theme variables are retained. Illustrative and local authenticated PoC variants share the panel. No DB04-only page mode is introduced.

New files:

- app/api/reconciliation/gpt-evidence/route.ts — saved-evidence GET, unavailable by default.
- components/reconciliation/gpt-suggestions.tsx and lib/gpt-evidence-view.ts — source UI/DTO, adapted to main theme tokens; suggestions, abstentions, verification, loading/empty/error states, no scores fabricated or financial approval action.
- lib/server/reconciliation/gpt-website.ts — source Jason-guarded/audited handler, decoupled from the historical concrete backend through GPTSavedEvidenceReader.
- lib/server/reconciliation/workspace-gpt-adapter.ts — source verified-caller adapter requiring explicit permission policy; no assumed FINANCE/ADMIN/SUPERADMIN equivalence.
- lib/server/reconciliation/gpt-runtime.ts — only the source restricted runtime/target gate; no pipeline, provider or persistence stack imported.
- lib/server/reconciliation/gpt-saved-evidence.ts — extracted source listSaved reader and principal hashing; no GPT generation or financial persistence. Same tenant/job/source-bound joins, actor check, latest-ten bound and transactional READ audit. Restricted runtime is checked on the same transaction connection.
- Three focused tests under tests/reconciliation-persistence, including the extracted reader tests.

Updated files: components/demo/modules.tsx, app/reconciliation/illustrative.tsx, components/poc-reconciliation/workspace.tsx (imports and panel mounts only).

Intentionally omitted: historical service/backend/processing/ranking code, AI01–AI05/E5 modules, Groq transport/prompt/parser, migration and catalog/install SQL, native fixture installers, old deployment/recovery reports, local datasets, review ZIPs and environment files. No new package dependency or lockfile change. No AI model call is added, so main's withAiCall requirement is preserved.

## Migration and activation

Migration 005 is already deployed and must NOT run again. This branch does not need its SQL or Git attributes to display existing evidence. Exact reviewed group SQL remains immutable at source commit 6a071e0 with SHA256 e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e; it was neither copied nor executed here.

Production retrieval remains disabled: gptWebsiteRuntime() returns null and the reader retains GPT_LOCAL_ONLY for Production/Vercel. Main's public demo never becomes a saved financial evidence authority. No credentials loaded or database contacted.

Activation still requires Jason/workspace owner's verified session service and explicit permission policy; Chia/DB04 owner's stored authorized batch-to-job and identity/capability mapping; approved restricted group runtime and durable audit connections. No source-hash/UUID ownership guess or privileged workspace RPC fallback. Reading saved evidence commits audit writes, so even a hosted read smoke test needs separate authorization. These are external implementation/configuration blockers, not an invitation to bypass guards.

## Verification

- Focused: 23 passed, 0 failed, 0 skipped (UI/API/workspace adapter and extracted reader).
- Compatibility: 14 passed, 0 failed, 0 skipped (main multi-period reconciliation, Jason transaction guard and main AI-call boundary).
- Total this port: 37 passed, 0 failed, 0 skipped. Historical source native/browser results are retained as prior evidence and not recounted or rerun.
- Next route type generation, full TypeScript, focused ESLint, server boundary and git diff --check passed.
- Initial typecheck found missing tesseract.js/pdfjs-dist in the reused old source installation. Pointing this worktree's ignored dependency junction at the already installed current-website modules resolved it; core versions matched. No installation, package edit or unrelated OCR workaround.
- No textual merge conflicts. Main had no DB04 services: resolved the dependency gap by extracting only the saved reader/runtime gate instead of copying the full stack. No main file wholesale replacement.

Commands: installed vitest with --pool=threads --maxWorkers=1; focused files gpt-website.test.ts, workspace-gpt-adapter.test.ts, gpt-saved-evidence.test.ts; compatibility files tests/demo/multi-period.test.ts, tests/security/transaction-guard.test.ts and tests/ai-calls/guard.test.ts. Results in ignored .local/reviews/ai06-minimal-*.json. Next typegen and tsc --noEmit --incremental false; focused eslint and scripts/verify-server-boundary.mjs.

## PR readiness

Ready for a narrow code-review PR as an inactive saved-evidence UI/API increment. Not ready for live Production activation. Local only: no push, PR creation, merge, deployment, provider call, migration or Supabase operation. Source branch/worktree preserved.
