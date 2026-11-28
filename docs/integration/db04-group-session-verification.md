# Group Session pooler verification — 3 November 2026

Branch: feature/db04-ai06-group-integration. Baseline: 943e0ef3e904fb5ba338cc3ba51ddc63dc7b20c9.
Target: zmtdozblpvtjniehwjrw / postgres, PostgreSQL 17.11.

The operator corrected only the private URI password fields. No database password,
role, grant, migration, Auth, frontend or Vercel change was made by this verification.
The earlier 28P01 failures remain historical evidence; this run supersedes their
authentication status without claiming the original attempts succeeded.

## Read-only connection evidence

Both restricted logins authenticated through the exact approved Session endpoint
aws-0-ap-southeast-1.pooler.supabase.com:5432. The application pg driver reported
authorized TLS sockets and matching server names. Database/session roles matched
db04_group_test_runtime and db04_group_test_broker respectively.

Both LOGIN attributes were enabled. Connection limits were 4 and 2, memberships
were exactly their approved non-admin runtime/broker parents, and neither role had
privileged membership, superuser, BYPASSRLS, role/database creation or replication.
All eleven reconciliation tables had enabled/forced RLS. Runtime had SELECT/INSERT
without broader mutations; broker had no financial table privileges. Neither role
had public foundation table/column access. These are catalog checks, not proof of
organization isolation during financial processing.

## Implementation and verification

The operator-only target guard now accepts the exact Session endpoint with the
role.project username binding, while retaining the exact Direct endpoint. Both
require port 5432, postgres, supplied CA and certificate validation. Custom hostname
validation overrides and mismatched server names are rejected. There is no fallback.
The runner reads the selected private file explicitly rather than inheriting stale
credential variables or loading its owner connection into the process environment.

Six selected local test files: **55 passed, 0 failed, 0 skipped**. This includes
10 target/security tests. All three reviewed SQL checksums passed; no SQL was rerun.

## Hosted workflow stopped

One hosted scenario invocation stopped at **RUNTIME_TLS**. Runtime role authentication
passed, but its existing server-side pg_stat_ssl check did not pass through the
Session pooler. This differs from the separately confirmed client-to-pooler TLS
certificate/hostname check. The pooler's backend-hop security is not established
by that client evidence. No guard was removed and the workflow was not retried.

The scenario reached three checks: registered fixture fingerprints PASS, runtime
restricted authentication PASS, runtime server-side TLS FAIL. It stopped before
broker scenario checks, capability issuance, financial processing or COMMIT.
Financial persistence/retrieval, actual E5 inference, duplicate/reconnection and
organization isolation workflow checks were **not executed**. No provisioning
completion or AI06 completion marker was issued. No financial writes occurred.

Next dependency: establish the approved Session pooler's backend TLS semantics and
an acceptable end-to-end verification method, or obtain an approved working Direct
restricted connection. Do not replace the failing check with an unconditional pass.
Production authentication and real ingestion remain separate interfaces.

No commit or push was performed. Draft PR #59 remains unmerged and unchanged.
