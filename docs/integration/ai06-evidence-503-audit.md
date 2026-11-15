# AI06 evidence 503 audit

2026-11-15. Base main `a1e4adeaa9ae73c2fe3ee90e5b636a540026c565`.
Branch `fix/ai06-evidence-503-audit-celester`. No Production configuration, SQL, permissions,
generation flags, shared transaction/authentication services or migrations changed.

## Findings and confirmed fixes

1. **False runtime denial:** the gate counted EXECUTE grants on private-schema helpers
   even without schema USAGE. A default PUBLIC EXECUTE grant therefore rejected a login
   that could not call the function. Reproduced as a failing native test before the fix.
   The gate now checks effective function access (USAGE AND EXECUTE). The same test passes
   afterward; granting schema USAGE makes the helper callable and still denies the runtime.
   No privilege, policy or RLS requirement is relaxed or granted.
2. **Wrong outage classification:** expected operate() job/lineage denials and session
   expiry were flattened by the shared transaction wrapper into PERSISTENCE_FAILED/503.
   AI06 now preserves safe typed reasons through rollback: exact known SQL authorization
   messages become opaque 404 or 401 respectively. Unknown privilege failures remain 503.
   No financial data or distinction between missing and other-owner jobs is returned.
3. **Invalid UUID classification:** the old 36-character hex/hyphen regex accepted 36
   hyphens, then storage rejected them and returned 503. Strict UUID validation now rejects
   invalid requests with 400 before identity/job lookup.
4. **Unobservable errors / misleading UI:** config and factory failures silently returned
   false/null, and all other errors were generic. Added AI06-only allowlisted server events
   and a generic administrator-contact UI message; an outage no longer claims that the
   user's saved database batch is missing.

The supplied screenshot identifies an unavailable UI, not the exact failing stage. A
refresh on the authenticated real Production Reconciliation page reproduced that state.
The browser console did not provide request/error metadata. The available Vercel account
still receives the project's access 404, so Production settings/logs were not inspected.
**The exact Production root cause remains unconfirmed.** The private-helper defect is a
proven possible cause, not a claim about currently deployed role grants or flag values.

## Complete response/error trace

| Boundary | Failure / response | Safe server reason |
| --- | --- | --- |
| Legacy DB04 GET `/api/reconciliation/gpt-evidence` | Runtime deliberately null; 503, unchanged | Separate disabled DB04 path; not this website store |
| Website GET `/api/reconciliation/website-gpt-evidence` | Storage not configured/factory null; 503 | CONFIG reason plus STORAGE_UNAVAILABLE |
| Retrieval flag | `FINGENCE_GPT_SUGGESTIONS` not 1; intentional 503 | GPT_STORAGE_DISABLED |
| Backend / approval / dedicated URL | Missing or invalid contract; 503 | GPT_BACKEND_UNAPPROVED / GPT_APPROVAL_REQUIRED / GPT_DATABASE_URL_MISSING / GPT_DATABASE_INVALID |
| Target / TLS / restricted login | Wrong group host/user/database, unapproved pooler or invalid TLS config; 503 | GPT_RESTRICTED_CONNECTION_REQUIRED or GPT_DATABASE_INVALID |
| Pool connection | Certificate, login, DNS/socket/timeout or other failure; 503 | DB_TLS_FAILED / DB_AUTH_FAILED / DB_NETWORK_FAILED / DB_CONNECT_FAILED; DATABASE_UNAVAILABLE |
| Workspace identity | RPC unavailable or exception; 503; anonymous/ended remains 401 | SESSION_SERVICE_UNAVAILABLE / SESSION_VERIFICATION_FAILED |
| Middleware | Missing session cookie gives 401; proxy itself has no 503 branch | Existing optimistic cookie gate unchanged |
| Query validation | Malformed UUID, duplicate/extra parameters; 400 | No database lookup |
| Catalog gate | Unsafe role/membership, effective unrelated function access, direct table/column rights, missing forced RLS/table/function contract; 503 | GPT_RUNTIME_DENIED; catalog query errors classified at RUNTIME |
| operate() authorization | Known job/member/organization/ingestion mismatch; 404. Known DB session denial; 401 | GPT_JOB_DENIED / GPT_SESSION_DENIED |
| operate() infrastructure/audit | Other permission denial, missing objects, duplicate/integrity or unknown SQL failure; 503 | GPT_SQL_ACCESS_DENIED / GPT_SQL_CONTRACT_MISSING / GPT_SQL_DUPLICATE / GPT_SQL_FAILED |
| Transaction | Failed/unknown commit or unconfirmed rollback; 503, no retry | PERSISTENCE_FAILED / COMMIT_OUTCOME_UNKNOWN / ROLLBACK_UNCONFIRMED |
| Returned scope / DTO | Wrong subject, invalid response/UNRESOLVED contract or missing evidence fields; 503 | GPT_SCOPE_DENIED / GPT_STORAGE_INVALID / GPT_EVIDENCE_INVALID |
| Valid authorized job without evidence | 404 and atomic READ_EMPTY audit, not an outage | No invented result |

Disabling generation, missing GROQ_API_KEY3, gateway disabled or budget unavailable does
**not** itself cause saved-evidence GET 503. These prevent new generation; existing reads
continue when authorized. Without saved evidence the result is 404. Readiness diagnostics
use GPT_GATEWAY_DISABLED, GPT_KEY3_MISSING or GPT_BUDGET_UNAVAILABLE; provider/proposal
failures remain withhold-and-audit, never financial approval or fallback to other keys.

## Diagnostic privacy

Filter private server logs for `AI06_GPT_DIAGNOSTIC`. Events contain exactly `event`,
`stage` and `reason`, all fixed allowlisted strings. They contain no URL, credential,
session hash, user/job/record identity, SQL statement/data, fingerprint, model text, raw
error or stack. Pool observer reuses the existing strict TLS parser and transaction wrapper;
it never retries or disables certificate verification. Client 503 remains only
`{"code":"GPT_UNAVAILABLE"}` (workspace-service unavailability retains its existing generic
SIGN_IN_REQUIRED code with HTTP 503). No internal diagnostic is added to client headers/body.
Console diagnostics are best effort; required SQL audit remains atomic and fail closed.

## Verification actually executed

- 53 focused error/route/config/session/pool/DTO/UI cases passed.
- 13 affected storage/security tests, 7 exclusive key-3 tests and 13 generation/evidence
  regressions passed (86 focused tests total).
- 22 native PostgreSQL 18.6 cases passed in the proven disposable loopback cluster,
  including current workspace v1-v7 fixtures, exact reviewed website SQL, restricted
  login, concurrent claims, immutable evidence, job/source/session isolation, malformed
  saved DTO, missing function, real TLS refusal/login failure, audit failure and rollback.
  Existing workspace/ingestion/processing catalog definitions and deterministic results
  remained unchanged. Synthetic data and mocked provider only.
- **108 unique final passes; zero unresolved failures/skips in the full targeted suites.**
  The initial single-test failing reproduction and its 13 deselected cases are not counted
  as successful tests. Old evidence was not added to these counts.
- TypeScript, changed-file lint, server-boundary and production build passed. The local
  dependency junction required the documented temporary Turbopack-root override;
  next.config.ts was restored exactly. No Production credentials/configuration used.

## Remaining Production checks

After review and approved deployment, capture the event for one affected refresh. Do not
paste secrets, environment values, SQL rows or complete logs: only stage/reason is needed.
First verify the actual endpoint is the website route. If CONFIG reports disabled or
missing settings, correct only the owner-approved setting; do not enable generation merely
to diagnose retrieval. If POOL reports failure, verify the dedicated group/main connection
and certificate configuration without privileged fallback. If RUNTIME reports denial,
review current role/RLS/ACL metadata; do not grant unrelated schema/table access.

For the specific private-helper hypothesis, this **review-only, unexecuted** catalog query
shows effective access without reading application records (verify exact group/main first):

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='10s';
SELECT n.nspname,p.proname,
 has_schema_privilege('fingence_ai06_website_login',n.oid,'USAGE') AS schema_usage,
 has_function_privilege('fingence_ai06_website_login',p.oid,'EXECUTE') AS execute_grant
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname IN ('fingence_workspace','fingence_processing','fingence_ingestion',
 'fingence_reconciliation','fingence_db04_group_synthetic')
 OR n.nspname='public' AND p.proname LIKE 'fingence_%')
AND has_function_privilege('fingence_ai06_website_login',p.oid,'EXECUTE')
ORDER BY n.nspname,p.proname;
ROLLBACK;
```

Rows with execute_grant=true but schema_usage=false explain the old false denial. A
callable unrelated entrypoint remains a genuine blocker. SQL-side session/job denials now
require checking the active owner's completed job and ingestion relationship, not inventing
an ID mapping. Invalid immutable evidence must be investigated; do not overwrite it.
No live Groq call, model activation, Production SQL, permission/configuration change,
merge or deployment was performed during this audit.
