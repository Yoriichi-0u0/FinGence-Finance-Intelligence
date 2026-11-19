# Hosted verification resumed after operator TLS enforcement

3 November 2026. Branch `feature/db04-ai06-group-integration`, baseline
`943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9`. PR #59 remains unchanged/unmerged.
This supplements, rather than replaces, the earlier Session pooler failure report.

## Confirmed read-only evidence

Target: group project `zmtdozblpvtjniehwjrw`, database `postgres`, PostgreSQL 17.11.
Both restricted logins authenticated on the pinned Session pooler at port 5432.
Both client sockets were certificate-authorized with the expected TLS server name
and TLSv1.3. Both own-backend pg_stat_ssl rows now report ssl=true, TLSv1.3,
TLS_AES_256_GCM_SHA384. The formerly failing runtime assertion is now true.
This measures client verification and upstream encryption separately; it does not
independently establish the managed pooler's upstream certificate-validation mode.
The operator reports enabling enforcement; this agent changed no hosted setting.

Restricted membership/flags, connection limits 4/2, runtime SELECT/INSERT-only access,
broker financial denial and no runtime/broker foundation access were catalog-verified.
All eleven DB04 tables retained enabled and forced RLS.

The separate read-only scenario-prefix replay passed all ten preflight checks:
registered fingerprints; runtime authentication/TLS; broker authentication/TLS;
eleven forced-RLS tables; no public financial grants; no runtime foundation access;
no broker financial access; no-capability financial read denied (zero visible jobs).
It stopped before admission, E5 or financial writes.

## Hosted attempt and remaining admission failure

All three reviewed SQL file hashes verified. No migration, seed or activation ran.
One full approved workflow invocation stopped with a generic sanitized error after
entering its restricted-preflight/workflow stage. The existing runner did not return
its partial check list, failed operation or inner SQLSTATE. No successful financial
COMMIT receipt was returned, and the attempt was not automatically retried.

Read-only diagnosis reproduced a concrete synthetic admission defect: the application
passes `new Date(Date.now()+30000)` to issue_hosted_grant, while the function rejects
deadlines beyond `clock_timestamp()+interval '30 seconds'`. Measured server clock
was approximately 0.9 seconds behind the application clock. A bound deadline check
returned exceeds_approved_maximum=true, expired=false. Calling the same fixed issue
function inside BEGIN READ ONLY returned SQLSTATE 42501, followed by ROLLBACK.
That diagnostic wrote no identity or financial rows. This reproduces an admission
guard failure consistent with the stopped invocation; its original inner exception
was not captured, so it is not presented as an observed SQLSTATE from that invocation.

No hosted E5 inference, persisted financial readback, duplicate/reconnection or
cross-organization workflow success is claimed. Full provisioning/workflow completion
is not declared. The original invocation's financial state must not be inferred solely
from its generic error; inspect under the approved scope before any future retry.

## Exact proposed correction — NOT implemented

Files: `lib/server/reconciliation/group-synthetic.ts` and focused broker/admission tests.
Replace the fixed broker issue query with:

```sql
SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant(
  $1,$2,$3,$4,$5,clock_timestamp()+interval '30 seconds')
```

Pass the existing hash, lease UUID, issuer, subject UUID and session UUID as five
parameters. Remove the client-created sixth expiry parameter. Update the exact
broker query allowlist to this one query (retain the existing revoke query).
This changes no stored function, identity rules, permissions or maximum lifetime.
Unknown queries remain denied. Test that caller wall-clock skew cannot extend the
database-derived lease and that arbitrary broker operations remain rejected.
Preserve the host/project/role/CA/hostname checks and both TLS assertions unchanged.

This source correction requires explicit review/authorization before implementation.
After approval, inspect the fixed synthetic processing context without reprocessing,
then resume only if transaction outcomes and mandatory security checks are resolved.
No password reset, role/grant/schema change, setting change, commit or push occurred.

Proposed commit title once corrected and verified:
`fix(db04): bind group synthetic leases to database time`

Proposed PR #59 update: describe exact Session endpoint support and explicit private
configuration loading; record both TLS legs and restricted permission evidence;
explain clock-skew-safe admission and actual test counts; preserve previous failures
and distinguish synthetic authority from Jason's real authentication integration.

## Local regression evidence

Standard directory run: 103 passed, 0 failed, 4 optional E5 checks skipped.
Offline-E5-enabled run of the three affected files: 38 passed, 0 failed, 0 skipped.
The second run includes those four formerly skipped checks; the union is **107
distinct tests passed, 0 failed, 0 unexecuted** (not 141 distinct tests).
This includes **37 native PostgreSQL tests**, real offline E5 inference/persistence,
rollback/immutability/isolation tests and the complete 22-check local scenario.
These local PostgreSQL 18.6 results do not establish hosted PostgreSQL 17.11 success.
TypeScript, scoped ESLint, server-boundary and git diff whitespace checks passed.
No application correction was implemented during this resume task; only this new
evidence document and ignored diagnostic/review artifacts were added. The three
earlier Session-pooler implementation/test changes remain uncommitted and intact.
