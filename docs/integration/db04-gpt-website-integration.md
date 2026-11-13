# AI06 GPT suggestions in the existing reconciliation website

13 November 2026. Branch feature/ai06-gpt-integration-celester.

## Implemented

The existing /reconciliation page retains its design, totals, deterministic outcomes, filters and record controls. A shared GPT Matching Suggestions Panel sits below the reconciliation summary and before records in the default connected demo, illustrative preview and authenticated PoC. The local DB04 workspace also includes the same panel. No new page or matching/approval action was added.

Saved runs display model/prompt/evidence identity, time, BANK/LEDGER claims, authoritative references, explanations, reasons, independent verification and source SHA256 lineage. Abstentions and empty model output are distinct. All statuses remain UNRESOLVED. No score is stored by GPT migration 005, so the display explicitly says unavailable; E5 scores are not relabelled as GPT confidence. React escapes text. Verification is collapsible. Loading, empty, unavailable and error states are provided. AbortController plus keyed batch loads prevent old requests replacing a new selection; the authenticated PoC additionally keys the panel by user/organization/membership version.

## API and database boundary

GET /api/reconciliation/gpt-evidence?batchId=... is dynamic/private/no-store and same-origin cookie authenticated when provisioned. No POST, inference, persistence or review route exists. Request batch IDs are hints only; no tenant, user or capability is accepted from query/body/browser state.

The dependency-injected handler reuses Jason's createTransactionSecurityGuard with batch.read, verified principal and server-resolved access scope. A trusted owner resolver must map that batch to an organization-bound DB04 processing job and approved group capability. The group backend listSavedGPTEvidence path resolves principal() on the checked restricted connection and binds BOTH user and organization to the verified security context, checks job existence, reads the latest ten saved runs and their items, and joins tenant/job/kind-bound source records for references. It uses the deployed gpt_runs/gpt_items, no additional tables or migrations.

The evidence read's DB04 READ audit commits with the query. Jason's runAuditedRead additionally commits a content-free durable batch.read event before the API releases any payload. Missing mapping, mismatched principal/tenant, incomplete evidence, revoked capability or audit failure yields no data. Repeated reads do not insert GPT runs/items; each is audited. Persistence duplicates continue to use the existing immutable/idempotent service. Reading evidence has audit writes, so it must not be tried against Production without approval.

## Fail-closed activation status

The real route uses gptWebsiteRuntime(), which deliberately returns null. It therefore returns 503 and the current website shows unavailable rather than fabricated saved evidence. No environment switch, owner fallback, JWT decoder, test identity, private credential search or synthetic capability bridge was added.

Required owner handoffs remain:

1. Jason's verified login/session + active membership principal and current authorized batch-scope resolvers. Existing group synthetic capability identity is NOT a Supabase Auth JWT identity. No implicit mapping is allowed.
2. A database-resolved ingestion batch/source-pair to DB04 job mapping and approved group capability lifecycle. Browser-demo processing IDs cannot be assumed to be stored jobs; without a stored mapping the panel stays unavailable. The illustrative preview supplies no batch and does not fetch.
3. A pinned restricted group runtime pool, and an approved durable security-audit connection. The existing group financial runtime must not be granted public audit/identity privileges as a workaround. No assertion is made that the required Jason audit schema/permissions are installed on Production; those are an activation prerequisite for the audit owner.
4. Separately authorized activation/wiring and controlled synthetic Production smoke test. Existing GPT_LOCAL_ONLY guards remain intact, including audited evidence reads. No live Groq requests, Production financial reads/writes, schema/role/credential changes, push/merge or Vercel changes occurred.

Status: **website UI and API composition implemented; isolated synthetic PostgreSQL flow verified; live functionality disabled by security dependency gate**. No interactive browser or deployed website acceptance test was performed; UI checks use actual React server rendering and the actual client loader bridged to the API in the native test.

## Verification

- New website/UI/API suite: **8 passed, 0 failed, 0 skipped**. Covers actual route default denial, saved evidence rendering and escaping, all UI states, auth failures, wrong role, cross-tenant/out-of-scope batches, missing mappings/evidence, audit failure, repeated reads and stale response rejection.
- Updated isolated group native suite: **21 passed, 0 failed, 0 skipped**. Three new website cases run actual persistence, concurrent deduplication, restricted runtime, API handler, loader, React rendering and durable PostgreSQL security audit; exercise actor/capability tenant binding, empty evidence and revoked audit INSERT. Existing native cases remain in the same fixture and cover persistence/reconnects, isolation, provider failures, immutability, FK/RLS, rollback, E5 and deterministic compatibility.
- One relevant regression invocation: **36 passed, 0 failed, 1 skipped**, covering public demo pipeline/notices, deterministic matching, financial page selection, GPT persistence and Jason's security guard. The skipped test requires an unconfigured private March/6,000-row dataset (FINGENCE_POC_DATASET_DIR); it is not a pass and was not loaded or fabricated.
- Total executed assertions this task: **65 passed, 0 failed; 1 skipped**. Prior 104-pass evidence is historical, not added again.
- TypeScript, focused ESLint, server-boundary script and git diff --check passed. Two TypeScript-only test fixture errors were fixed before the successful typecheck; no production contracts weakened.
- Native tests use a new disposable loopback PostgreSQL 18 instance and synthetic source fixtures. Official Jason audit SQL is installed ONLY in that fresh local test fixture with a separate restricted audit login; this is not a hosted migration or a request to deploy that SQL. Groq remains mocked. The deployed group 005 checksum remains e53f8ffdc6f7ce2b9a5935a24761d65fa71c17b3a5cd4640d957cdf13da2b69e.

## Changed files

New: components/reconciliation/gpt-suggestions.tsx; lib/gpt-evidence-view.ts; lib/server/reconciliation/gpt-website.ts; app/api/reconciliation/gpt-evidence/route.ts; tests/reconciliation-persistence/gpt-website.test.ts; this report and PR description.

Updated: app/reconciliation/illustrative.tsx; components/demo/modules.tsx; components/poc-reconciliation/workspace.tsx; components/db04/workspace.tsx (panel mounts only); lib/server/reconciliation/gpt-persistence.ts (actor-bound audited saved-list method); group-gpt-backend.ts (expose saved-list method); gpt-group-compatibility.native.test.ts (local audit and website flow).

Pre-existing uncommitted AI06 work is preserved. No existing migration, authentication/security implementation, deterministic calculation, E5 implementation or ingestion service was edited.

Commands used (installed tools; no dependency installation):

- node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/gpt-website.test.ts --pool=threads --maxWorkers=1 --reporter=verbose
- FINGENCE_DB04_GPT_NATIVE_APPROVED=1; node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/gpt-group-compatibility.native.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/gpt-website-native.json (explicit loopback execution permission; machine-local TEMP)
- node node_modules/vitest/vitest.mjs run tests/demo tests/poc-reconciliation/matching.test.ts tests/reconciliation-persistence/financial-pages.test.ts tests/reconciliation-persistence/gpt-persistence.test.ts tests/security/transaction-guard.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/gpt-website-regression.json
- node node_modules/typescript/bin/tsc --noEmit --incremental false
- node node_modules/eslint/bin/eslint.js [the changed TypeScript/TSX files]
- node scripts/verify-server-boundary.mjs; git diff --check

## Final security handoff inspection and browser attempt — 13 November 2026

Outcome: **BLOCKED for Production activation**. No application, security, runtime or credential configuration changed in this follow-up. The existing GPT handler still composes Jason's guard/audit with the group adapter only when trusted dependencies are supplied; gptWebsiteRuntime() still returns null. No safe Production connections could be completed. Do not treat a dependency interface as an installed authentication service.

Inspected once: current website DemoProcessingProvider, M2 local identity/runtime/cookie contracts, M5/PoC flags, generic hosted admission, group runtime/principal binding, server pool configuration, Jason's transaction guard/scoped reads/audit services and the actual GPT runtime seam. The default website is a browser-only synthetic demo without server sign-in. M2/M5/PoC sessions and local-session-sum are explicitly local-only experiments, not approved Production substitutes. The older hosted admission is bound to a different target/issuer and was neither used nor connected. No unrelated Supabase project or secret file was accessed. A name-only check of the current shell found no matching group/runtime/database configuration variables; dotenv contents and personal configurations were not searched. This does not assert that no credentials exist elsewhere.

### Exact required handoffs

| Owner | Missing interface / resource | Required handoff |
| --- | --- | --- |
| Jason, authentication/security owner | resolvePrincipal(request): Promise<TrustedPrincipal or null> | Verified server cookie/session or token, authoritative active organization membership and role, suspension/revocation lifecycle; returns subjectId, organizationId, role. No browser claims or JWT decode-only adapter. |
| Jason + batch/ingestion owner Chia | resolveAccess(principal, request): Promise<TransactionAccess> | Authoritative subject/organization/scopeVersion and current batchIds. The security guard already enforces batch.read and actor/tenant equality. Supply an actual Production implementation and ownership source, not a request-derived list. |
| Chia + DB04/AI06 owner Celester, with Jason approving identity binding | resolveBatch(principal,batchId): Promise<{organizationId,batchId,processingId,capability} or null> | Stored tenant-bound ingestion-batch/source-pair to DB04 jobs mapping, plus approved capability issuance/revocation lifecycle. The group synthetic issuer/admission is different from real Supabase Auth; the group principal user ID must match Jason's verified subject (or an explicitly designed/approved identity binding). Browser processing hashes and local session cookies are not authorization. No such adapter/mapping service is installed here. |
| Group database owner + application runtime owner | Restricted financial TransactionDatabase/pool for the exact group/main | Privately provision existing approved runtime connection through the secure server secret mechanism. Pin db.zmtdozblpvtjniehwjrw.supabase.co:5432/postgres and verified TLS via assertGroupGPTConnection, use that same checked pool, and establish main branch provenance. Never owner/service/broker fallback. No credentials in reports or chat. No pool is instantiated by the GPT website route. |
| Jason, audit owner + group database owner | Durable audit TransactionDatabase/service | Existing approved permission to commit content-free batch.read success/denial/failure events through public.security_audit_events. Confirm deployed audit action/target contract and RLS/INSERT/sequence permissions through the responsible owner. Group financial runtime permissions are not evidence that it can write Jason's audit store; do not widen them as a workaround. No new audit migration or permission change proposed/executed in this task. |

After these owner-supplied interfaces exist, compose GPTWebsiteDependencies with the existing group adapter; preserve both actor/tenant binding and audit-before-response. Production evidence retrieval itself appends audit records, so it remains prohibited by this task's no-Production-writes restriction. The existing GPT_LOCAL_ONLY guard additionally requires a separately approved controlled activation change. No new permissions or capability approval were inferred.

### Final relevant regression

Executed only tests/integration/backend-security.integration.test.ts: **22 passed, 0 failed, 0 skipped**. It checks the existing producer/persistence/scoped-read and durable-audit contracts with isolated synthetic local PGlite data. Command: node node_modules/vitest/vitest.mjs run tests/integration/backend-security.integration.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/gpt-browser-20261113/security-regression.json.

The first sandboxed attempt could not connect to its disposable local socket: suite setup failed and 22 tests were skipped, not passed. The subsequent approved loopback execution ran all 22 successfully. Prior 65-pass/1-private-dataset-skip evidence is retained as historical; it was not repeated or added to this turn's count. No functional TypeScript change required another typecheck/lint/native suite.

### Interactive browser result — not completed

Prepared an ignored disposable copy of the current app/components/lib/public with no dotenv files and a child-process environment allowlist excluding database/provider configuration. Bound only to 127.0.0.1:3216. Tried the actual existing /data page in Chrome as preparation for /reconciliation; Next.js compilation stalled with both compilers before the page rendered, and browser navigation timed out. Servers were stopped. No synthetic documents were processed in the browser and no suggestions, abstentions, loading, empty or error state was visually verified in this follow-up. The previously passed React/native/API tests do not count as this interactive test.

Local-only font fallback, explicit CSS scan boundaries and false local-backend flags were tried in the disposable copy to isolate startup; original application files were untouched. The actual reconciliation UI/page source checksums were recorded in .local/reviews/gpt-browser-20261113/setup.json. No saved Production evidence or real authentication was loaded.

A proposed fallback localhost component harness using the unchanged existing UI and explicitly labelled synthetic response fixtures was NOT executed: automatic approval review could not complete because its usage limit was reached. This was a review-service failure, not an unsafe-action determination. No alternate route was used to bypass that approval failure.

Next browser action requires the approval service to recover or user guidance for the blocked local execution, then a working isolated browser harness or Next development server. Synthetic fixture rendering must be labelled and cannot certify real authentication, tenant authorization or Production access. Full Production browser acceptance remains blocked by the owner handoffs above.

Changes in this follow-up: this report and the existing PR description only, plus ignored local diagnostic evidence/review ZIP. No migration, Production write/read, Groq call, Vercel change, Git push or merge.

## Finalization — current result (supersedes the earlier browser blocker)

13 November 2026. **OFFLINE WEBSITE VERIFIED; PRODUCTION ACTIVATION BLOCKED ON EXTERNAL HANDOFFS.**

### Startup diagnosis and isolated fix

The prior copy started Next.js but stalled compiling pages. A bounded standalone Tailwind/PostCSS diagnostic succeeded and generated 58,209 bytes of CSS. The isolated test profile then precompiled the same app CSS, disabled PostCSS plugins in that copy, used webpack with one CPU and RAYON_NUM_THREADS=1, and retained the earlier offline font fallback. Next.js served /data and /reconciliation successfully. This resolves the local verification startup issue; it does not establish a general Next.js defect or justify changing the real website build configuration. All changes stayed in ignored .local/reviews/gpt-browser-20261113/site; original Next config, layout, styles, security guards and application code were not changed.

The sample selector initially rejected all three copied CSVs. Their Windows CRLF bytes did not match the published manifest. Converting only those isolated copies to LF matched every published SHA256 exactly; the existing manifest/checks were not weakened. Selected those verified fictional samples and used the actual Process Financial Documents button. Browser processing completed with 57 BANK and 57 LEDGER rows, 50 matched outcomes and nine quarantined exceptions. Root cause of sample rejection is therefore confirmed byte-level line-ending drift. Original public/demo files remain untouched.

### Actual interactive browser evidence

Chrome visited the existing /data and /reconciliation routes at 127.0.0.1:3216. The GPT panel appeared between the cash summary and outcome records using the existing design. The unchanged real API first returned 503 and the page showed unavailable: no auth fallback was activated.

Only in the credential-free disposable copy, a clearly labelled synthetic response fixture then exercised:

- Saved suggestion and abstention display, model/prompt identity, references, UNRESOLVED, reasons and unavailable score (no score invented).
- Clicking Supporting evidence and independent verification disclosed source hashes and verification fields.
- Empty saved evidence, delayed GPT loading and HTTP 500 error states.
- The error state contained no stale prior suggestion IDs. No approval button was present in the GPT panel. Existing reconciliation totals/counts stayed unchanged across fixture modes.

Screenshots/AX proof: .local/reviews/gpt-finalize-20261113/{ready,unavailable,loading,error}.png and {ready,unavailable,loading,empty,error}.txt. The successful fixture response is explicitly labelled Synthetic browser response fixture. Not saved Production evidence. It proves real UI/client request handling, NOT real Production authentication or persistence. The earlier isolated native tests remain the evidence for actual saved PostgreSQL evidence, tenant isolation and audit-denial rollback; they were not rerun.

After verification the fixture API was removed and the copy's API restored byte-for-byte to the original fail-closed route. The temporary browser tab and test server were closed/stopped. Source checksums for the real reconciliation page, shared GPT component and demo module still match the pre-lab manifest. No database/provider environment variables or dotenv files were copied or used; no hosted project was contacted.

### Final checks and security boundary

One final regression invocation: gpt-website.test.ts, **8 passed / 0 failed / 0 skipped**, including verified-context composition, tenant/batch denial, missing evidence, durable audit failure, UI rendering, stale response rejection and the actual unconfigured route. Command: node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/gpt-website.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/gpt-finalize-20261113/final-regression.json. Original application code did not change, so no completed native/typecheck/lint suite was repeated. Diagnostic CSS compilation and source-integrity/fixture-removal checks passed; git diff --check passed. Prior 65-pass (one private-data skip) and 22-pass results are historical, not recounted here.

The once-only current interface inspection confirms the exact missing owner contracts listed above: Jason's verified principal/active membership and durable audit runtime; Jason/Chia authoritative batch access; Chia/Celester approved stored batch-to-job/capability mapping and lifecycle; group owner restricted runtime configuration. Only dependency-injected contracts and local-only identity experiments exist. No new approved Production implementation or group-specific credentials/runtime was supplied. Available security services are already composed; connecting local identities, another project's issuer or an arbitrary database URL would be a bypass and was not done.

No Production configuration, financial write/read, migration, permission change, live Groq, push/merge or Vercel deployment. gptWebsiteRuntime() remains null and GPT_LOCAL_ONLY remains enabled. Real website-to-saved-evidence activation cannot be certified until those external handoffs exist, runtime/branch/TLS are verified and an owner separately approves the audited Production smoke test. Evidence retrieval itself writes durable audits and remains outside this task's allowed Production operations.

PR handoff: implementation is ready for owner-supplied dependencies and controlled activation review. Production is **not activated**. Do not copy the fixture route or disposable build profile into the real application.

## Main/teammate contract integration — latest authoritative follow-up

13 November 2026. Local checkout remains feature/ai06-gpt-integration-celester. Inspected local main/origin-main at 72731f2e7664c05210c03eee418b5fdd7c2c7261 and cached teammate refs without checkout, fetch, merge or external access. These are locally available snapshots, not a claim that GitHub has no newer commits.

New finding superseding the earlier checkout-only conclusion: **main does have a real server-session implementation**, at lib/server/workspace/session.ts. Its caller(headers) hashes the HttpOnly fingence_session cookie, asks fingence_workspace_principal, and distinguishes ANONYMOUS, ENDED, UNAVAILABLE and SIGNED_IN active members. Workspace principal IDs are UUIDs in workspace SQL (including organization IDs); SAIC is the organization name, not an invented UUID/text conversion. The current feature checkout does not contain this newer workspace implementation. Main saved-run/history functions enforce owner/organization access. These must not be confused with DB04 job capabilities.

Inspected refs and relevant findings:

- main and origin/main 72731f2: workspace session/store/history and processing jobs/store/routes; real workspace principal and saved-run ownership, service-role-only PostgREST store configuration. No DB04 group identity/job/capability mapping.
- origin/feature/cybersecurity-jason 7868d6e: authorization, transaction guard, active scope dependency interfaces and durable security audit. Existing GPT handler already reuses these functions; concrete verified principal/access providers are owner dependencies.
- origin/feature/ingestion-batch-lifecycle 88f2e23 and origin/feature/ingestion-integration-contract 1bc07b6: batch/accepted-data producer contracts; no group capability issuer or workspace-to-DB04 ownership bridge.
- origin/feature/backend-api-celester 9385da7: protected batch/financial-query contracts; no missing identity bridge implementation.
- origin/claude/hosted-identity-roles 6c4fc7b and origin/claude/server-jobs-console 400a5bb: workspace role/session and processing job contracts; same distinct storage/identity boundary. Main processing accepts a public-default organization when workspace is off: NEVER reuse that fallback for saved GPT evidence.

### Completed safe adapter

Added lib/server/reconciliation/workspace-gpt-adapter.ts:

- createWorkspaceGPTPrincipalResolver receives the auth owner's verified caller(headers) implementation. It requires SIGNED_IN with a session/member/organization identity, returns only memberId -> subjectId, organization.id -> organizationId and a conservative security role, and never returns email, session token or token hash. ANONYMOUS/ENDED return null; unavailable/malformed verification fails closed. It does not parse browser identity claims or invoke privileged RPCs.
- FINANCE maps to Jason's finance_analyst; ADMIN/SUPERADMIN map to administrator. Workspace's stacked admin roles are NOT promoted into Finance batch access: Jason's existing guard denies administrator batch.read. No new permission inferred.
- createWorkspaceGPTWebsiteHandler connects that resolver to the existing GPT handler, Jason guard and durable audit composition. Owner-supplied resolveAccess, resolveBatch, restricted backend and audit database remain mandatory. Workspace identifiers are preserved; no guessed association to group identities or source hashes.

This is a server-only composition adapter, not active registration. gptWebsiteRuntime remains null; public demo and live route remain fail closed. No old workspace files were copied/merged from main, and no service-role/owner/other-project configuration is used. The adapter must receive a verified server callback; it is not an authentication algorithm on its own.

### Exact remaining handoffs / actions

1. Workspace session maintainer, with Jason's security approval: supply the reviewed caller(headers) service through an approved restricted server interface. Main workspaceStore/ingestionStore currently selects SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY and SECURITY DEFINER RPCs. The GPT integration must not instantiate that privileged store or repurpose its secret as financial runtime credentials. Direct privileged fallback is prohibited; no such calls were made. Confirm deployed workspace version/role semantics separately; SQL comments are historical and do not establish deployed state.
2. Chia + workspace batch/history maintainer + Celester (DB04): provide trusted stored mapping from workspace member/organization and authorized saved run/batch/source pair to group-synthetic user/organization and the exact DB04 processing job; provide authorized capability issue/revoke lifecycle. Both systems using UUIDs does not prove identity equivalence. Cached main has NO such DB04 bridge. Group capabilities cannot be manufactured from fingence_session, workspace tokenHash, default organization, a browser processing ID or a matching source filename. No mapping table or permission invented.
3. Jason/Chia: supply current resolveAccess(principal,request) backed by authoritative batch ownership. Main's saved-run ownership RPC is useful evidence of ownership but is not a DB04 batch/job capability and cannot be relabelled as one.
4. Group database/application runtime owner: privately supply the approved restricted financial PostgreSQL pool, pinned group/main/TLS configuration and approved restricted durable-audit connection. Jason's public.security_audit_events and main's separate workspace audit log are distinct contracts; no audit sink substitution or financial-runtime permission widening is allowed. No credentials/configuration were discovered, modified or used.

The missing bridge is a data/authorization contract, not merely a missing environment flag. With no trusted correspondence or approved restricted runtime available, live connection cannot safely be completed. Existing GPT_LOCAL_ONLY and route-null gates remain. No Production financial writes, live Groq, schema/credential/configuration changes, Git push/merge or deployment.

### Focused verification (run once)

workspace-gpt-adapter.test.ts: **6 passed / 0 failed / 0 skipped**. Covers verified identity minimization, inactive/anonymous/unavailable/malformed callers, no admin elevation, composition through Jason batch guard/audit, cross-organization mapping denial, audit failure withholding/no retry. Backend and auth callbacks are synthetic unit doubles; this does not certify real group mapping or Production connectivity. Existing PostgreSQL/browser/UI suites were not repeated.

TypeScript, focused ESLint, server-boundary and git diff --check passed. Commands: node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/workspace-gpt-adapter.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/workspace-gpt-adapter-tests.json; node node_modules/typescript/bin/tsc --noEmit --incremental false; focused installed ESLint; node scripts/verify-server-boundary.mjs.

Activation status: **SAFE ADAPTER PREPARED; PRODUCTION BLOCKED ON THE SPECIFIC OWNER HANDOFFS ABOVE**. Prior browser and native evidence retained. This update changes only the new adapter/test and integration/PR documentation.

## Final live-reference readiness checkpoint — 13 November 2026

Checked GitHub directly through the read-only connector, not just cached refs. Main and the four relevant teammate branch heads match the commits inspected above exactly. Live main session.ts, Jason's transaction-guard.ts and Chia's accepted-data.ts blob SHAs also match the local inspected versions. No newly supplied Production mapping/runtime interface was found. No checkout, fetch, merge or remote write performed.

Current status: **IMPLEMENTATION/EXTERNAL-HANDOFF BLOCKED, NOT APPROVAL-ONLY READY**. The prepared verified-workspace principal adapter already composes with Jason's guard, actor/tenant-bound GPT reader and audit-before-response handler. There is no safe new Production connection to enable from these unchanged contracts. The privileged workspace store is not an acceptable substitute under the current restrictions.

Exact next deliverables:

| Responsible owner | Required dependency/action |
| --- | --- |
| Jason / workspace authentication maintainer | Supply an approved verified-session/active-membership service implementing the adapter's verifyWorkspaceCaller(headers), accessible without the GPT integration invoking privileged RPC or receiving service-role credentials. Confirm its deployed contract. |
| Chia + Celester / DB04 | Supply authoritative resolveAccess and resolveBatch backed by stored tenant/owner/source-pair relationships to the exact DB04 processing job, and an approved group capability lifecycle. Existing workspace UUIDs and ingestion batch IDs do not establish a DB04 identity/job link; source hashes alone are not authority. No such mapping implementation exists in the unchanged inspected main/teammate contracts. |
| Group database/runtime owner + Jason audit owner | Supply approved restricted financial TransactionDatabase/pool configuration pinned to the group project/main with verified TLS, plus the approved durable audit service/connection. No credentials, owner pool, generic unrelated database URL or privileged RPC fallback may be used. No approved runtime was supplied to the GPT composition. |
| Group owner, after the above exist | Separately approve controlled audited retrieval/activation. Even a successful GET appends DB04 and security audit events, so this task's no-Production-writes restriction prohibits a hosted smoke test. Lifting GPT_LOCAL_ONLY additionally requires explicit activation approval. |

All live gates remain closed: gptWebsiteRuntime() returns null; the public demo stays synthetic, and no request can bypass capability/RLS/audit checks. No application or security code changed at this checkpoint. No Production database access, migration/schema/configuration change, financial write, Groq call, push, merge or deployment occurred.

Focused adapter integration: **6 passed**. One final saved-evidence/API regression: **8 passed**. Combined current invocation: **14 passed, 0 failed, 0 skipped**. Tests use injected synthetic services and mock databases, not Production. Existing native/browser/AI01–AI05 suites were not repeated. Command: node node_modules/vitest/vitest.mjs run tests/reconciliation-persistence/workspace-gpt-adapter.test.ts tests/reconciliation-persistence/gpt-website.test.ts --pool=threads --maxWorkers=1 --reporter=json --outputFile=.local/reviews/gpt-final-activation-check.json. Documentation diff check passed.

This completes independent verification and the local PR handoff; the missing relationship/service/configuration must be delivered by its owner before further activation work can make progress. Rechecking unchanged branches cannot create these dependencies.

## Explicit role permissions — final adapter hardening

13 November 2026. Reused the completed live-main/teammate inspection and deployment evidence; no repeated blocked connection attempt or database inspection. Main's session/store/processing implementations are distinct from the DB04 group principal/capability contract and currently use privileged workspace RPCs. No permitted restricted bridge or configuration has been supplied.

Removed hard-coded FINANCE/ADMIN/SUPERADMIN role equivalence from workspace-gpt-adapter.ts. createWorkspaceGPTPrincipalResolver now requires WorkspaceGPTPermissionPolicy with an owner approval reference and explicit per-workspace-role security-role entries. createWorkspaceGPTWebsiteHandler requires that policy. Missing/invalid policy fails before session verification; unmapped roles fail closed. No hierarchy inheritance. The mapping is snapshotted/frozen so later mutation cannot widen access. Jason's existing resource/batch guard still independently decides permissions. The reference is trusted operator configuration, not proof of approval or an HTTP parameter; no actual Production policy has been supplied. Test policies are labelled SYNTHETIC_TEST_ONLY.

Available composition remains: owner's verified session callback -> explicit role policy -> Jason guard -> trusted batch/job/capability resolver -> restricted GPT reader -> durable audit before response. Public demo and gptWebsiteRuntime remain unchanged/disabled. No import or invocation of main's privileged store/RPC was added; PostgreSQL credentials are not loaded or exposed.

Changed-code verification only: **8 passed / 0 failed / 0 skipped** in workspace-gpt-adapter.test.ts. Includes existing verified identity, tenant and audit cases plus missing policy/no inheritance and policy-mutation denial. TypeScript, focused lint, server-boundary and diff checks passed. Completed UI/browser/native suites not rerun.

Exact remaining deliverables (implementation/configuration blockers, not routine confirmation):

- Jason/workspace auth owner: approved verified session service accessible without privileged GPT RPC, plus explicit reviewed role permission policy. Current default route has neither; no anonymous/public membership fallback is allowed.
- Chia + Celester/DB04: stored, authorized correspondence between workspace member/organization, website processing job/ingestion batch and group user/organization/DB04 processing job, including source lineage and approved capability lifecycle. Neither matching UUIDs nor file hashes establish permission. No approved existing database relationship supports constructing this bridge in the inspected contracts.
- Group runtime owner + Jason audit owner: privately supplied, approved restricted group PostgreSQL configuration and durable audit service/connection, with exact group/main/TLS binding and existing required permissions. No owner/service-role or generic privileged RPC fallback. No permissions or credentials were changed.

Outcome: **safe adapter complete; Production integration remains BLOCKED by these genuine missing dependencies**. Successful retrieval also appends audit records, so a hosted activation smoke test requires separate approval under the present no-Production-writes restriction. No Production operation, schema/configuration change, live Groq, push/merge or deployment occurred.
