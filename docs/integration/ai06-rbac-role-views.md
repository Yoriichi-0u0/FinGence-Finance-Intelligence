# AI06 GPT role views

Scope: AI06 website GPT evidence only. Existing workspace role definitions, authentication and the deployed AI06 operate() ownership contract are reused. No global FINANCE API redaction is claimed. History, processing APIs, technical logs, shared RBAC, DB04 and existing SQL are unchanged relative to main. No new Production SQL or configuration is required by this change.

## Responses and UI

- FINANCE receives an explicit server-side financial projection of its own saved GPT evidence: suggestions/abstentions, financial references, explanations, verification result and UNRESOLVED status. Processing IDs, source hashes, evidence IDs, model/prompt versions and raw verifier JSON are absent from the HTTP response, not merely hidden in the UI.
- PASS requires the existing website-pair-verifier/1 policy and all four checks true. A failed check gives FAIL. Missing/unknown verification is UNAVAILABLE; abstentions are NOT_APPLICABLE. No score or result is invented.
- ADMIN and SUPERADMIN retain the full technical evidence for their own jobs. Every role still uses the same verified session and existing organization/member/job-bound operate() read. An elevated role grants no cross-user GPT access. Audited read failures release no evidence.
- Persisted immutable evidence and audit are unchanged. Generation, shared gateway/GROQ_API_KEY3, budgets, pilot restrictions, duplicate prevention and automatic bounded polling are unchanged. No financial matches are approved or totals changed.

## Validation (16 November 2026)

146 tests passed, 0 final failures, 0 skips: 121 mocked AI06 role/API/UI/polling/storage/503/key3/DB04-compatibility regressions plus 25 isolated native PostgreSQL 18.6 tests. No live provider call or hosted database access.

Commands: vitest run tests/reconciliation-persistence/{gpt-role-views,gpt-polling,website-job-gpt,website-gpt-storage,website-gpt-503,ai06-key3,gpt-website}.test.ts; separately opt-in website-gpt-native.test.ts on the explicitly verified disposable loopback cluster. Native tests install only unchanged existing SQL. All three real workspace session roles can read their own audited evidence and receive 404 for another member's job through the actual restricted runtime and operate(). Cross-organization response denial is covered by mocked API scope tests; the real workspace intentionally permits one organization. The initial new native fixture attempted a second organization and was corrected to honor that existing constraint, without changing application or database security.

TypeScript --noEmit --incremental false, ESLint on the six changed TS/TSX files, server boundary and Next.js Production build passed. Build flags disabled live processing/AI. A temporary local Turbopack root override for the Windows dependency junction was restored byte-for-byte and is not part of the diff.

No AI06 implementation blocker remains in this scope. Team review/CI and separate merge/deployment approval remain normal release gates. No Production change, activation or live verification was performed. Legacy recheck APIs remain outside AI06 scope and are preserved.


## Finance preview display fix (16 November 2026)

Root cause: the backend correctly uses the verified signed-in role; an Admin/Superadmin selecting View as Finance still legitimately receives its own full evidence. The AI06 component previously rendered technical fields solely based on response shape and ignored the workspace preview role.

The component now reuses useTechnicalDetail() and projects a full authorized response into the existing financial display shape when the selected view is Finance. This is presentation reduction only: no client role is sent to authorize requests, no API scope or role mapping changes, and actual FINANCE continues receiving server-redacted evidence. Returning to normal Admin/Superadmin view restores technical details without mutating saved evidence or restarting polling. The Finance view also omits the technical website-storage/DB04 caption; Refresh remains an optional fallback.

Executed 130 tests across seven AI06 regression files: actual FINANCE response redaction, Admin/Superadmin normal and Finance previews, equivalent simplified output, inability to reconstruct a Finance response by selecting a higher client role, ignored client preview headers at the API, cross-user/organization denial, audit failure, key3 routing, generation and polling. All passed, zero failures/skips. The unchanged operate() and SQL retain the previously executed 25 native PostgreSQL tests from PR #129; those are reused evidence, not a new run. No SQL, environment, workspace-provider, teammate module, generation, storage or backend authorization change is required.
