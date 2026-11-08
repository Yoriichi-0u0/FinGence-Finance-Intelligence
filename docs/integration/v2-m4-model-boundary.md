# M4 — source-bound model interpretation and evaluation

Development checkpoint, 30 October 2026. Stacked on M3; not a hosted release.

## Working local path

`pnpm m4:dev` starts `http://127.0.0.1:3184/ai-ingestion` with the existing local
session/membership/tenant controls. Provision an OS-local account using `pnpm m4:account`
with the same private environment inputs documented in the M3 runbook. No fallback user
exists. Node 24.22.0, pnpm 11.19.0 and the configured `.venv-ai/bin/python` are required.
Stop the local server before CLI commands that open its disposable PGlite database.

The browser always selects **RECORDED_TEST**, using a dynamically generated offline
semantic control through the Provider03 interface. It is not genuine model execution or
a live accuracy result. It performs real extraction, deterministic materialization,
independent verification, quarantine and atomic tenant-owned V2 persistence. The same
batch feeds Transactions, Analytics, Reports and deterministic sourced answers. Original
M2 SIMULATED receipts remain distinguishable. Financial publication stays ineligible.
No experimental record is cast into C1. `/data` is unchanged.

`m4/adapter.ts` connects the existing GroqProvider03-compatible interface to M2. Its
additive `fingence_m4.inferences` journal records operation/execution, user/organization,
source/prompt/policy hashes, prompt revision, authorization reference, original proposed
plan and receipt. The journal commits before transport. Completed malformed, incomplete
or null-convention output is retained rather than replaced by an expected proposal.
Only schema/finish-valid proposals reach materialization; the unchanged independent
verifier alone decides financial outcomes. A valid receipt is never financial proof.
Metadata/investigation requires active Finance membership, an active M3 organization and durable audit acknowledgement.
Revocation while a provider is pending prevents financial persistence, even when its
completed receipt is retained for investigation.

Provider state is separate from financial state: DISPATCHING / COMPLETED / NOT_EXECUTED /
UNKNOWN. A completed response can yield only unresolved records. Unknown transport or
journal acknowledgement blocks investigation from claiming CONFIRMED_NOT_COMMITTED and
never triggers automatic retry. Reusing an operation cannot execute another attempt.
Raw proposals are server-only. The local schema denies anon/authenticated access.

## Offline evaluation

Run `pnpm m4:evaluate`. Six opaque synthetic inputs in `synthetic/m4` cover CSV, XLSX,
digital PDF, scanned PDF, PNG and JPEG. Frozen source-authored labels live separately in
`tests/fixtures/ai-ingestion-m4/gold.json`; they are loaded after processing, never passed
to a provider, materializer or verifier. Labels preceded control execution. These cases
remain held out from a live provider, not blind to the developer who authored them.
The generator refuses overwriting frozen inputs. No descriptive filename enters prompts.

Reports are owner-private JSON and readable text under `.ai-local/increment-i2/` with
random filenames. Metrics separate extraction literals, mapping precision/recall, context,
document classification, conventions, unsupported assumptions, accepted/rejected/unresolved,
false acceptance, source references and total pipeline latency. Completed but unusable
outputs remain in the schema denominator. Failed extraction stays in the literal
accuracy denominator. Recorded usage is null, not fabricated zero-token inference.
The pure scorer cannot authenticate a live receipt and always leaves genuine performance
null; only the owner CLI, after its real non-injected provider path, can attach live scores.

Configured control run: 6/6 completed, 58/58 exact literals, 8 accepted, 0 rejected,
4 unresolved, 0 false acceptances. Unknown financial field and unsupported bank movement
cases abstain. All accepted held-out rows carry warnings: include/exclude policy matters.
CSV source-signed total with warnings included is MYR 304.75; ledger debit/credit rows
cannot produce a source-signed total. Neither amount is revenue, expenditure or cash flow.
Genuine M4 provider requests: **0**. Genuine model performance: **unavailable**.

## First live experiment — separate owner authorization required

No authorization/key creation or live request occurs in this checkpoint. HTTP cannot
activate live dispatch even if a key and flags accidentally exist. `m4:dev` also clears
Groq/Ollama dispatch flags. The following applies to the new M4 CLI, not every older
provider entrypoint in the repository.

1. Reconfirm owner permission for exactly one registered CSV request, fixed model
   `openai/gpt-oss-20b`, synthetic-only evidence, Free Plan and **US$0 for this request**
   within the historical US$5 experiment ceiling. No paid fallback exists. Obtain secure
   local key configuration separately; never paste keys into chat, Git or logs.
2. Inspect the actual account's plan, remaining RPM/RPD/TPM/TPD, model permission and data
   controls. Public [rate limits](https://console.groq.com/docs/rate-limits) are not account
   entitlement evidence. Groq documents strict structured output support for this model
   in [Structured Outputs](https://console.groq.com/docs/structured-outputs).
   [Data controls](https://console.groq.com/docs/your-data) include abuse-monitoring retention
   exceptions and optional ZDR; record the owner's informed choice, not an invented setting.
3. Stop the local server. `pnpm m4:prepare synthetic/m4/m401.csv` reserves one tenant/user
   operation and writes only a proposed-dispatch manifest under `.local/m4-prepared/`.
   It does not create an authorization. Review its blind prompt/source/policy hashes and
   conservative token bound (7,740 for this frozen CSV, including 1,600 output tokens).
4. Freshly approve two private records under the **existing shared canonical**
   `.ai-local/increment-03`: the I2 source-bound one-shot record and matching
   `m4-authorizations/<id>.json` validated by exported `ownerGrantSchema`. The M4 sidecar
   binds the original operation, user, organization, membership version, prompt/policy,
   model, verified account-specific limits and privacy/budget attestations. It expires
   within 15 minutes. Files must be owner-only, non-symlink (600, directories 700).
   No command here creates either record. Quota limits may be lowered, never raised.
5. Explicit flags are necessary but insufficient: `FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED`,
   `FINGENCE_M4_AUTHORIZATION_ID`, the existing Groq dispatch/Free Plan flags and private
   key are checked. Dispatch once via `pnpm m4:dispatch <registered-file> <original-id>`.
   The shared quota ledger is resolved from the Git common directory, never reset or
   replaced with a worktree ledger. Reservations include all prior entries. A durable
   single-use grant is consumed under the quota lock. No automatic retry is enabled.
6. A canonical `m4-dispatch.pending` fence is written before the provider call. A crash,
   unknown request, journal failure or unresolved reservation blocks future experiments
   across worktrees. It is removed only after own known result acknowledgement. Do not
   delete markers/restore quotas to enable retries. Inspect original operation, receipt,
   quota reservation and owner authorization before any separately reviewed recovery.
7. Reports must be writable before dispatch. Actual model, usage, finish reason, receipt,
   blind hashes, independent outcomes and post-hoc gold scores are preserved locally.
   Only after reviewing the first real CSV result should another format be authorized.
   Larger evidence may exceed the conservative TPM reservation and must remain blocked;
   no silent prompt truncation or quota increase is implemented.

## Verification boundaries and team reuse

Tests under `tests/ai-ingestion-m4` exercise fake transports only; their LIVE-shaped
receipts never establish genuine accuracy. Native PostgreSQL tests cover in-flight session,
membership, role and organization revocation, audit rollback, a one-connection pool and restricted roles.
Disposable PGlite controls cover source preservation, malformed proposals, duplicate
attempts, unknown investigation, grant binding, symlinks, account limits and durable fencing.
Existing full C1/P2/M2/M3 tests remain applicable. Production flags cannot enable the local
routes; build tracing excludes private state and labels.

Chia owns this composition; Celester's V2 ownership/persistence contracts, Jason's guards,
receipts/audit and membership controls, Frederick's exact source calculations and Izzat's
selected-batch/report UI are reused. Issues #6–#9 remain integration ownership references,
not teammate approval gates. No hosted identity, financial policy approval or live chatbot
has been enabled. No main/PR merge, hosted schema change or Production release is included.
