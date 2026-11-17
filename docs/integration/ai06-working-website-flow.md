# AI06 authorized website job flow

Persistence update: the hosted adapter and review-only SQL now supersede the filesystem
activation instructions below. See `ai06-hosted-storage.md`. Historical validation below
is retained; the app no longer selects the filesystem store, including on Vercel.

2026-11-15. Base main `98d47bac1aeb71907c0e761e1dc0c82e426d1403`.
Branch `feature/ai06-authorized-website-flow-celester`. Implemented locally; not activated.

## Working path

The existing authenticated processing route captures the server-verified member and
organization. After the existing job/ingestion/results transaction commits, an optional
hook rechecks the same session, organization, member, processing pause and AI switch.
It supplies the job's independently normalized BANK/LEDGER sources directly; the browser
cannot supply candidate records, tenant IDs or evidence. No DB04 identity is inferred.

Only deterministic matcher exceptions are candidates. Already matched records are excluded.
Over 50 candidates per side, ambiguous identities, quarantined jobs and late-running jobs
are withheld. One strict JSON completion uses the existing budget and structuredCompletion
gateway (`recon-suggest`, including withAiCall metadata logging). Provider output contains
IDs only; unknown IDs, duplicates and malformed JSON fail without saving evidence.
Independent checks compare authoritative IDs, exact signed cents, currency and seven-day
date distance. Failed checks are shown explicitly; every pair remains UNRESOLVED. Explicit
model abstentions and omitted candidates are distinguished. Scores are null, never invented.
No reconciliation result, approval, calculation or report is changed.

Saved evidence carries website organization/member/job, processing ID, record IDs,
references, BANK/LEDGER SHA256, model/prompt/verifier versions and timestamps. It is stored
separately from DB04. No original documents, credentials or complete source records are
copied into this store. The existing main DB04 endpoint remains disabled and unchanged.

GET `/api/reconciliation/website-gpt-evidence?jobId=<uuid>` verifies the existing workspace
session and reads only that exact organization/member/job evidence. Other members,
including administrators, do not receive an implicit override. Session failures fail
closed. Durable READ auditing must succeed before returning evidence. The existing
Reconciliation section uses the server job ID (not a guessed processing-ID mapping),
shows the saved evidence and offers Refresh while generation finishes after job commit.
Browser-only runs do not generate evidence. Reopening a saved server job uses its same ID.

## Persistence and activation limits

This fallback uses an explicitly configured **private persistent filesystem**, with hashed
paths, exclusive attempt claims, flushed writes, atomic no-overwrite hard-link publication
and metadata-only audit events. Failed/uncertain attempts are never redispatched automatically.
An attempt stranded by a crash requires operator investigation; do not delete claims or retry
blindly. SAVE_INTENT is an intent, not a database commit assertion; a published evidence file
is the result. Filesystem/audit failures never fail or overwrite the completed financial job.

This is application-level immutability and owner isolation, not PostgreSQL forced RLS.
DB04 forced RLS, evidence and migration 005 remain untouched. No new Supabase financial
connection, privileged fallback, RPC or database credentials are introduced. Existing
workspace authentication and gateway logging retain their existing internal implementations.

Disabled unless both `FINGENCE_GPT_SUGGESTIONS=1` and an absolute
`FINGENCE_GPT_EVIDENCE_DIR` are configured. Project-local storage must be under ignored
`.local/`; never use a public directory. Generation additionally requires the existing
AI gateway/key/budget configuration and a freshly authorized AI-enabled session.
No environment configuration was changed in this task.

Operator prerequisites: a durable private volume shared by serving workers, hard-link
support on that filesystem, restricted service-account ACLs (especially on Windows),
appropriate encryption, retention and recovery procedures. Do not use an ephemeral volume.
Vercel is deliberately refused even when flags are set: its local filesystem is not a
durable shared evidence store. Vercel activation still needs an approved durable storage
adapter or verified restricted DB04 mapping/runtime; no migration is proposed or executed.
Previous completed jobs are not backfilled and no financial data was read from Production.

## Validation

- 13 new offline tests passed: real synthetic processing pipeline and isolated PGlite
  PostgreSQL-compatible job transaction -> evidence persistence -> authorized API -> React
  rendering; valid/failed verification, abstentions, malformed/hallucinated/duplicate
  output, concurrent and failed attempts, member/tenant/session isolation, audit failure,
  private storage configuration, loader behavior and real shared gateway with mocked transport.
- 16 relevant existing tests passed: 8 GPT website/API/UI, 6 processing routes and 2 AI-call
  boundary tests. Total **29 unique passing tests**, no unresolved failures or skips in these
  full-suite runs. No native PostgreSQL/Production/browser interaction is claimed.
- Route type generation, TypeScript, changed-file ESLint, server boundary and diff checks passed.
- Windows sandbox initially blocked test-cache renames and atomic hard links. Those were
  infrastructure failures; affected synthetic tests passed with approved local filesystem
  access. A diagnostic filtered run's skipped tests are not counted as passes.
- No live model call, Production access/write, migration, configuration change, push,
  merge or deployment. No existing completed AI06 suites were broadly repeated.

## Proposed PR description

Connect AI06 suggestions to authorized website server jobs through a separate opt-in
evidence flow. Recheck workspace sessions after job commit, reuse the budgeted AI gateway,
verify proposals against trusted job sources and display immutable UNRESOLVED evidence on
the existing Reconciliation page. Preserve deterministic outputs and leave DB04 separate.

Changed scope: processing route/hook, website evidence service and GET route, existing
suggestions component/mount, focused synthetic tests and this document. Validation: 29
unique passing tests plus type/lint/server-boundary checks. Production activation remains
off; Vercel requires approved durable persistence. No schema or credential changes.
