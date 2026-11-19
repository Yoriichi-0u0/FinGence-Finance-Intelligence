# AI06 proposal-only review overlay — Issue #112

PR: https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence/pull/149

## Behavior and eligibility

The unchanged ingestion and reconciliation pipeline remains authoritative. This change never edits its original classifications, correcting entries, reports or totals. It adds an AI06-only candidate overlay, not a financial match or a new ingestion contract.

Candidate sources must pass existing business/currency, fingerprint, identity and reconciliation checks. The strict final-UNEXPLAINED approval scope remains unchanged. Extra proposal candidates may be:
- final UNEXPLAINED records;
- ENTRY_PREPARED receipt/payment-not-in-ledger records (not fees, amount corrections or duplicate-posting corrections);
- REFERENCE_ONLY / MATCHED_BY_AMOUNT exceptions, retained as originally classified.

Overlay records require no timing link, at most one ledger record in the item, a nonempty bounded reference, nonzero canonical signed cents and a canonical date. Extra pairs require exact signed cents, currency and business, <=2 days and exactly one financial partner on each side across ALL authoritative rows. Exact/date-shift deterministic matches, ambiguous-reference results and multi-record topology are excluded. A same-date reference-only deterministic explanation is a review exception, never presented as independent identity verification. All original entries and their source membership stay intact.

The independent verifier retains 26 boolean checks. Expanded candidates receive policy website-pair-verifier/2 and proposalPolicy website-review-only/2; they keep failed referenceAgreement, finalUnexplained and approval-eligibility checks. Their similarity never becomes trusted linkage. Strict legacy approval candidates retain their /1 policy and all existing checks. INV829/INV830 is never verified merely because amounts/dates agree.

## Saved outcomes and UI

Financial outcome always UNRESOLVED. Display suggestionState is derived, never accepted as a capability:
- VERIFIED: independently passing saved verification; human review still requires the existing SQL canApprove/canReject checks.
- NEEDS_REVIEW: model proposal with incomplete or failed evidence. Show the references and failed-check explanation; Approve remains disabled, while an authorized owner may Reject it once.
- NO_SUGGESTION: actual model abstention/omission; no manufactured match.

Suggested Matches now includes review needs, so genuine candidates do not disappear into an empty default view. Same/Different Reference filters use actual saved references. Counters distinguish Verified Suggestions, Needs Review and No Match Suggested. Pagination, Finance redaction, Finance preview, Admin technical details and bounded read-only polling are preserved.

## Database and version compatibility

NO SQL changes or migration. Existing operate() requires gpt-evidence-view/1 and website-job-gpt/1, so these storage envelope identifiers remain unchanged. The revised prompt is explicitly identified in saved verification metadata as website-review-prompt/2, and evidenceRevision website-review-evidence/2. Optional suggestionState is additive and validated against independent saved checks; historical items without it remain readable. Unknown verifier policies do not pass. New review-only verifier /2 is categorically not approval-eligible.

The restricted Postgres store performs an audited evidence read before review operations. It refuses APPROVE unless the stored item uses the existing website-unexplained/1 approval policy and verifies successfully. REJECT requires exactly one persisted SUGGESTION at the requested ordinal and the existing SQL ownership/session checks. Abstentions cannot be reviewed. Client-supplied states/checks/ownership are not review inputs. Existing SQL still independently denies /2 approvals and source/reference mismatches. RLS, grants, sessions, same-origin checks, idempotency, transaction locking, immutable decisions/audit and accountingEffect NONE are unchanged. No automatic retry after uncertain commits.

## Synthetic reproduction

Fixtures: tests/reconciliation-persistence/fixtures/ai06-reference-link/bank.csv and ledger.csv. These are complete new synthetic CSV documents; pinned fixtures are unchanged. SETTLEMENT-INV829 versus INV829 is explicitly NOT a proven authoritative link. The real pipeline prepares the original bank entry and leaves the ledger unexplained. A mocked Groq transport proposes their IDs, the real 26-check verifier records NEEDS_REVIEW, the existing native PostgreSQL operate() saves it, the verified workspace-session API returns it, and the actual Reconciliation component renders it in Suggested Matches. No reconciliation result or review decision is fabricated in this new end-to-end case.

The native test uses actual createJob/runJob and public processing RPC functions against the disposable local PostgreSQL cluster. Only the PostgREST transport and Groq network transport are test doubles. The shared structuredCompletion/withAiCall/key-3 path runs, one model receipt is logged, audit persistence is checked, unauthorized/approval review requests and direct unverified SQL approval are denied and saved figures/entries stay byte-for-byte identical. Positive legacy review contract fixtures remain explicitly labelled as constructed contract fixtures, not actual pipeline financial matches.

```sh
pnpm exec vitest run tests/reconciliation-persistence --exclude tests/reconciliation-persistence/website-gpt-native.test.ts --no-cache --maxWorkers=2
# Fresh isolated synthetic PostgreSQL ONLY, guarded URL/data-directory requirements are in the test:
AI06_NATIVE_TEST_URL=postgres://postgres@127.0.0.1:55487/ai06_native_review pnpm exec vitest run tests/reconciliation-persistence/website-gpt-native.test.ts --no-cache
pnpm test
pnpm typecheck
pnpm lint
pnpm check:server-boundary
node supabase/tests/verify-local.mjs
node supabase/tests/verify-upgraded.mjs
node tests/persistence/schema-compatibility.mjs
pnpm build
```

Do not point native tests at any existing or hosted database. No Production SQL, settings or credentials were accessed or changed. GROQ_API_KEY3 is preserved with no fallback or global mutation in runtime code.

## Acceptance limits

No live provider request was made. The real pipeline -> mocked model -> real verifier -> native PostgreSQL -> authenticated handler -> actual UI flow is tested; it is not a hosted browser upload or a live Groq acceptance claim. This branch cannot promise an approvable real-pipeline pair under unchanged equal-reference/final-UNEXPLAINED SQL: ordinary qualifying pairs are consumed deterministically. Positive live Approve/Reject remains unverified, and no policy was weakened to produce it. Review-only usefulness is complete without that approval.

Production deployment/activation and any future SQL policy change require separate owner authorization. Existing saved jobs are immutable and are not regenerated or retried; test a new authorized synthetic job after deployment. Issue #112 remains open for owner acceptance. No merge or deployment is part of this PR.

## Executed evidence — PR #149 baseline, 19 November 2026

- Full Linux regressions: 2110 passed, 0 failed, 89 skipped (2199 cases, excluding native file run separately). No skip guards were changed. Includes 15 new CSV contract/overlay tests; the earlier private diagnostic was preserved outside the repository test set.
- Focused AI06 run: 230 passed, 0 failed, no skips.
- Isolated native PostgreSQL 18.6: 43 passed, 0 failed, no skips. Includes one new real-job/RPC pipeline, shared gateway with mocked model, stored evidence, verified cookie, API, UI, audit and SQL-denial case. Existing positive /1 review tests are explicitly constructed contract fixtures, not claimed genuine pipeline positives.
- Type generation, TypeScript, lint, server boundary, original/upgraded SQL compatibility, persistence compatibility and Next.js 16.4.5 production build: PASS.
- 89 existing optional regression skips are unexecuted, including the previously documented 47 native cases in six unrelated suites whose environment could not start PostgreSQL. These are not passed tests; no ACL/security bypass or renewed environment troubleshooting occurred.
- Browser: Chrome opened a loopback-only static render generated by the native case from the actual saved Finance response, with built application CSS. Light/dark desktop and 390x844 mobile inspected; default Suggested Matches showed Needs Review 1, Verified 0, No Match Suggested 0, actual saved references, failed-check explanation and no review buttons. Mobile table has its own horizontal scroll; document width 375 <= viewport 390. This checks layout, not hydrated filter clicks, upload or a live session. Filter/role/pagination/polling behavior is covered by regressions.
- No live Groq, hosted workflow, positive genuine-pipeline approval, Production write, SQL change, configuration change, merge or deployment. Earlier in-cycle failing assertions/test fixtures were corrected and affected checks rerun; counts above are final results.

Reviewed installed SQL file remains SHA256 a67e4898b76983fc8ab49024a2e15e80a36780c8b0f0285740cae9814c9d8459. Its bytes are unchanged. No migration is required for review-only proposals.

## Minimal rejection follow-up — Issue #112

Only application rejection eligibility and existing table controls change. Approval matching/verifier/prompt policy remains unchanged. The table displays the existing controls for suggestions: SQL-backed VERIFIED permissions remain available; NEEDS_REVIEW has disabled Approve and enabled Reject for its authorized owner. After saving, the outcome cell and action area show Proposal approved/rejected; the independent matching outcome remains unchanged and financial outcome remains UNRESOLVED. Failed review loading/submission shows sanitized messages; duplicate clicks and explicit retry keys retain existing protection. A fresh API read restores immutable saved decisions.

No SQL migration is needed. Installed review() already permits REJECT on owned SUGGESTION items without the APPROVE verification gate. It binds reviewer member_id/organization_id from the verified session, records created_at, serializes the job, writes the decision and review_audit atomically, returns accountingEffect NONE and prevents changing a prior decision. RLS, grants, approval checks and historical data are untouched. Never rerun the installed SQL for this application change.

The native actual-CSV pipeline case now exercises: shared gateway with mocked Groq -> unchanged verifier -> durable NEEDS_REVIEW -> disabled Approve/enabled Reject -> denied approval -> two concurrent same-key rejection requests -> one decision and REJECT/REPLAY audit -> fresh state showing rejected -> conflicting new request denied -> direct SQL approval denied -> unchanged saved evidence and financial reconciliation. The reviewer identity and timestamps are asserted from PostgreSQL. Existing isolated VERIFIED /1 contract fixtures continue to test both decisions and security; they are not claimed as genuine new model VERIFIED matches. No live provider or hosted acceptance is claimed.

Focused command: pnpm exec vitest run tests/reconciliation-persistence --exclude tests/reconciliation-persistence/website-gpt-native.test.ts --no-cache --maxWorkers=2. Native command and disposable-cluster restrictions remain above. UI hook tests cover immediate status, duplicate suppression, retry identity, job changes, remount restoration and load errors. Earlier PR149 evidence below is historical; its disabled-Reject behavior is superseded by this follow-up. No merge, deploy, Production writes or settings changes are authorized by this document.

Final rejection-follow-up local validation: full Linux regression 2113 passed, 0 failed, 89 skipped; focused AI06 233 passed; native PostgreSQL 43 passed, no failures/skips. Type generation, TypeScript, lint, server boundary, original/upgraded SQL compatibility, persistence compatibility and production build all passed. The 89 existing optional skips include the documented 47 unrelated native cases; no skips or security guards changed. Native rejection test asserts one persisted decision with authenticated member/organization, database timestamp, REJECT/REPLAY audit, fresh state and unchanged evidence/financial JSON. Initial new test selector incorrectly matched Tailwind disabled styles; corrected the assertion and reran affected suites successfully. No live provider, hosted acceptance, Production SQL/configuration, merge or deployment performed.
