# AI06 hosted evidence storage — ready for review, activation disabled

2026-11-15; branch `feature/ai06-authorized-website-flow-celester`.
Supersedes the local persistence activation instructions in `ai06-working-website-flow.md`.
No Production access, hosted SQL execution, configuration change or live model call occurred.
The prepared SQL has now passed isolated native PostgreSQL 18.6 verification.

## Implemented

The app now selects a Vercel-compatible PostgreSQL adapter, never the local filesystem.
The old filesystem class remains only for retained offline tests. The authorized website
job hook, trusted normalized sources, JSON proposal schema, independent pair checks,
UNRESOLVED status, existing Reconciliation UI and budgeted AI gateway are reused.

The adapter uses the existing TLS PostgreSQL pool/transaction implementation, including
bounded timeouts, connection destruction after uncertain commits and no automatic retry.
Dedicated environment variables are mapped explicitly; generic Supabase/service keys are
never consulted by this adapter. Existing workspace authentication/gateway logging remain
unchanged. No financial service-role RPC fallback or Storage bucket service key is used.

Before each operation a same-connection catalog gate requires the dedicated unprivileged
login, only its execute-only runtime membership, forced RLS on all three new tables and
no direct table/column access or existing FinGence API execution. It rejects owner/admin/
bypass-RLS identities and public/schema CREATE privileges. The connection must use the
exact group host or an explicitly approved Supabase pooler host with the exact project
reference/login suffix, certificate-verified TLS and database `postgres`.
These configuration checks do not independently establish the dashboard branch identity.

The SQL API accepts a server-derived session hash and website job ID, not claimed tenant/
member IDs. It calls the existing workspace actor contract, verifies current active
membership and unexpired session, then verifies the stored completed job's member,
organization and ingestion-run ownership. Writes require the organization's AI/processing
controls to permit them. Reads remain available after AI is switched off to review existing
evidence, but still require active session and exact job ownership. Admin roles receive no
cross-member override. Application principal IDs must match the SQL-resolved identities.

CLAIM uniquely reserves one job across processes and freezes processing/source fingerprints
from the stored job results. A duplicate returns false before any provider dispatch. Failed
or uncertain attempts are not automatically reset. SAVE requires the claim, START audit,
matching job/source fingerprints, bounded payload, null scores and UNRESOLVED items. READ
and SAVE audit entries commit in the same transaction as their operation; audit failure
withholds results or rolls back persistence. Uncertain commits stop subsequent audit writes
and dispatch; they require operator inspection, not retries. Strict DTO validation applies
before SAVE and after READ. Audit contains only identities, action and timestamp.

## Proposed SQL — review only, not applied

1. `supabase/sql/ai06-website-gpt-storage-review.sql`: one atomic transaction creates
   private `fingence_gpt_website`, NOLOGIN `fingence_ai06_website_runtime`, tables
   `attempts`, `evidence`, `audit`, their indexes/constraints, immutable statement triggers,
   `immutable()` and the narrow `operate(text,uuid,text,jsonb)` API. It grants schema USAGE
   and EXECUTE on operate only, with no table/sequence rights. Forced RLS has no direct
   policies; rows are accessible only through the reviewed SECURITY DEFINER API.
2. `supabase/sql/ai06-website-gpt-login-review.sql`: separately reviewed dedicated LOGIN,
   database CONNECT, membership of the runtime role and timeout defaults. No password is
   embedded. Provision credentials privately through the owner's approved mechanism.
3. `supabase/tests/ai06-website-gpt-storage-catalog-review.sql`: post-installation metadata
   checks in READ ONLY/ROLLBACK; no financial rows. Also verify the owner's exact project/
   main branch, permissions and SQL definitions against the approved artifacts.

The new definer is explicitly owned by postgres to read existing forced-RLS workspace/job
contracts without altering their policies. This is a **new privileged function boundary
requiring owner security approval**, not a privileged application connection or fallback.
Do not execute it until that authority, the explicit FINANCE/ADMIN/SUPERADMIN own-job policy
and prerequisites have been approved. Unknown names collide and fail; no automatic repair.

No DB04 tables/migrations or existing teammate objects/policies/grants are changed. The
website evidence stays separate from DB04 `gpt_runs`/`gpt_items`; no cross-identity mapping
is invented. Existing jobs/member deletions are not blocked by new foreign keys: the only
FK is between new attempts and evidence. Authorization is revalidated on every operation;
an orphaned archived record is inaccessible if its original job/member link no longer exists.

## Proposed server configuration — no values changed

Review artifact SHA256 (working-file bytes; recheck after any Git normalization):

- Storage SQL: `dc81af41552dbf2ebb4df4fbce1fe011005c74139c98dedfc18297c513454fca`
- Login SQL: `806e74bc361b3a45a191672ce30afc01c99d37f3f560b8e2c8581b59bf0e90a4`
- Catalog SQL: `e600c30ab85eb4ab9d216e27c2beec5fcfdd8afa715ef4e47ce1426f2b8a6117`

| Variable | Required setting / handling |
| --- | --- |
| `FINGENCE_GPT_SUGGESTIONS` | Keep unset/0 until storage is approved/verified; then 1 enables storage/retrieval, not generation. |
| `FINGENCE_GPT_GENERATION` | Separate model-call switch, default off. Keep 0 through SQL/configuration/deployment verification. Set 1 only for a separately approved synthetic pilot or general activation. |
| `FINGENCE_GPT_PILOT_MEMBER_ID` | During the approved hosted pilot, exact trusted synthetic test member UUID. Other members cannot generate GPT suggestions. Invalid UUID fails closed. Remove only after separate approval for general activation. |
| `FINGENCE_GPT_STORAGE` | `postgres`. |
| `FINGENCE_GPT_STORAGE_APPROVAL` | `website-gpt/1` only after actual owner approval and verification. A string alone is not approval evidence. |
| `FINGENCE_GPT_DATABASE_URL` | Private dedicated `fingence_ai06_website_login` connection, group project/main only; never owner, service or DB04 broker credentials. |
| `FINGENCE_GPT_DATABASE_CA_CERT` | Private server CA PEM if required by the approved connection; TLS verification cannot be disabled. |
| `FINGENCE_GPT_APPROVED_POOLER_HOST` | Exact owner-verified Supabase pooler hostname when using pooling. Username must be dedicated login plus `.zmtdozblpvtjniehwjrw`; port 5432 or 6543. Direct group host permits port 5432 only. |

Existing `FINGENCE_WORKSPACE=1`, `FINGENCE_PROCESSING_JOBS=1`, `FINGENCE_AI_GATEWAY=1`,
an AI-enabled organization and the approved existing `GROQ_API_KEY` configuration are
still required. Reuse the approved existing gateway settings; do not copy credentials.
On Vercel a durable shared budget is mandatory: the existing complete
`FINGENCE_AI_BUDGET_REST_URL`/`FINGENCE_AI_BUDGET_REST_TOKEN` pair or its approved existing
Upstash/KV integration equivalent. Existing spend/rate policy remains unchanged.
No new provider key is introduced.
Use server-only secret configuration, never NEXT_PUBLIC variables or log statements.
Restart/redeploy only under separate approval after changing pool credentials/configuration.
The old `FINGENCE_GPT_EVIDENCE_DIR` is no longer used by application storage selection.

## Verification evidence and remaining work

13 focused tests passed using mocked PostgreSQL transactions, SQL API and provider:
dedicated project/TLS/pooler configuration, disabled defaults/no credential fallback,
runtime-denied behavior, tenant/member mismatch, audit failure, duplicate claims,
atomic API call shape, strict evidence/UNRESOLVED validation, invalid identifiers/negative
acknowledgements, verified session injection, uncertain-commit handling and generation ->
mocked durable storage -> retrieval -> existing React UI, separate generation switch and
pilot-member restriction.
13 additional native PostgreSQL 18.6 tests passed, 0 failed/0 skipped in the completed run:
the exact review SQL installed in a fresh disposable local cluster; real restricted login,
forced RLS, denied direct access, immutable evidence, concurrent claims, session/member/job/
ingestion isolation, source fingerprints, UNRESOLVED enforcement, atomic audit failure,
rollback and trusted synthetic pipeline -> mocked provider -> saved native evidence ->
real cookie/session verification -> Reconciliation UI. Existing workspace/ingestion/
processing catalog definitions and deterministic processing outputs remained unchanged.
Native testing found and fixed the runtime catalog gate's private-schema name resolution;
it now checks table privileges through catalog OIDs, without granting schema/table access.
TypeScript, changed-file lint, server boundary and diff checks passed.
Historical 29 tests are retained evidence, not rerun or added to this task's pass count.

Production build passed with the existing dependency junction accommodated by a temporary
local Turbopack root override; next.config.ts was restored byte-for-byte and is not part
of the diff. The initial sandbox font download and junction failures were local build
environment issues, not passing checks. No production configuration was used for build.
Native startup/setup failures and earlier failing tests were corrected; skipped setup/
diagnostic cases are not counted as passed. Ordinary CI skips native tests unless its
explicit disposable-cluster URL is supplied; the recorded local native run executed all 13.

These local tests do not establish actual Production permissions or schema compatibility.
The next approval is the owner security review and execution of the exact storage SQL
(checksum above) on group `zmtdozblpvtjniehwjrw`, Production main. No group operation was
attempted. Login provisioning, Vercel settings and deployment each remain separately
approved actions. Do not merge or activate automatically.

Execution order after approval:
1. Verify exact group/main identity and current workspace/processing prerequisites; apply
   only the approved storage SQL atomically. Never rerun DB04 migrations or repair errors
   automatically. Stop on any uncertain commit.
2. Approve/provision the dedicated login using the separate login SQL; configure its
   password privately. Run the prepared catalog checks and confirm runtime least privilege.
3. Approve the existing Vercel project's server-only variables above, initially with
   generation 0. Review/approve/merge the PR and approve the existing deployment process.
4. Verify hosted storage/session behavior, then explicitly authorize one synthetic pilot:
   generation 1 plus the approved synthetic member UUID, budget limits and public synthetic
   BANK/LEDGER fixtures only. Create a new authorized website job, refresh its existing
   Reconciliation section and verify saved evidence, audit, duplicates and isolation.
   Set generation back to 0 after the test unless general activation is separately approved.
   There is no production mock-provider backdoor or backfill endpoint for old jobs.

Recovery: any installation error rolls back that file's transaction; never retry an
uncertain commit. Keep the feature off during rollout. After a confirmed commit, disable
the feature to stop new operations and retain evidence/audit; do not automatically drop
tables or revoke teammates' permissions. Set a separate approved archive/retention and
backup plan. Short member/session/job SHARE locks may contend with access changes; bounded
timeouts fail closed and no locks remain open during provider calls.

**Live activation: NO.** Hosted architecture is implemented and locally native-tested; schema,
execute-only login/rights, secure configuration and actual hosted behavior remain unverified.

## PR description update

Replace local-only AI06 website evidence selection with a dedicated Supabase PostgreSQL
adapter compatible with Vercel. Reuse authorized jobs and the existing AI gateway/UI;
prepare an additive execute-only, session/job-bound SQL API with atomic audit and immutable
evidence. Preserve DB04 and teammate objects. Validate with 13 focused mocked security/
integration tests plus 13 native PostgreSQL tests; leave Production disabled pending SQL
approval and real group/Vercel verification. Code review and deployment approval remain required.
