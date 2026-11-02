# DB04 / AI06 group integration candidate

3 November follow-up: [combined DB01–DB04 deployment review](db01-db04-group-approval.md)
adds an explicitly separate, owner-review-only synthetic deployment package. It is not
installed, does not provide real team authentication, and does not supersede the
Production identity/ingestion requirements below. Original candidate evidence is retained.

2 November 2026. Based on main `cb5db4625ceca1cb94867a90a8a3edddbcf1e6ba`;
reuses the implementation from `901109b9057bfeb927367955bdc69d2e346a09e4`.
Branch: `feature/db04-ai06-group-integration`. Personal development PR #57 is
preserved separately; its hosted synthetic success is not group deployment evidence.

## Implemented

Ported the existing exact-decimal processing/persistence service, deterministic
matching, AI02 fuzzy scoring, offline pinned E5 worker/provider, independent proposal
verification, trusted CashSource adapter, processing-context validator and five financial
read models. Reused main's PostgreSQL transaction adapter and its no-retry handling for
uncertain commits. Matching algorithms and frozen AI01–AI05 evidence are unchanged.

`createReconciliationBackend` now requires an injected `FinanceAdmission<IdentityContext>`
instead of constructing personal FYP A hosted admission or a development broker. It
provides internal `process(identity, documents, e5?)` and `get(identity, processingId)`.
The caller owns pool shutdown. No database credential lookup, connection factory,
identity fallback, public HTTP route or frontend activation is introduced.
The facade rejects missing/invalid source registration, preventing the lower-level
legacy PoC default from being selected accidentally in group composition.

The only shared existing application change is the type of `cashTotals`' input:
`Pick<SourceRow, 'direction' | 'signedAmount'>[]`. The exact implementation is unchanged.
This permits reusing that function with persisted cash records without fabricating the
unrelated source fields. All Phase 1 pages, context types and browser runner remain unchanged.

Original DB04 SQL 001–004 is byte-preserved under
`tests/reconciliation-persistence/sql/` solely to exercise disposable local PostgreSQL.
These are NOT group migration candidates. No personal synthetic installer, seed,
inspection login, environment file, issuer, hosted broker, backup tooling, local
DB04 route or UI override is ported. The frontend-independent financial-view tests
and native core tests are retained; personal inspector and local HTTP/UI tests are omitted.

## Trusted interfaces still required

### Jason: admission and database authority

Implement the injected server-only `FinanceAdmission` using approved authentication,
verified subject/session lifecycle, active Finance membership and active organization.
Resolve organization and role from authoritative server state, never a request body.
Authorize before invoking the supplied callback. Supply its short-lived database
capability and clean it up afterwards; a revocation uncertainty must not cause a
financial operation retry. The service hashes a 43-character base64url capability
transaction-locally; database `principal()` and RLS must bind it to the same user and
organization with expiry/revocation/version/suspension enforcement.

The exact database identity interface is unresolved: current local tests use
`fingence_m2.organizations/users/memberships/sessions` and
`fingence_m3.organization_states`, plus optional M5 suspension. The group must supply
actual durable identity keys and membership composite uniqueness before adapting FKs
or the principal functions. Map shared `finance_analyst` to the approved Finance permission;
do not silently equate differently named roles. Runtime must not own tables, bypass
RLS, administer roles or issue capabilities. A separate authority/broker must not read
financial tables. No replacement password/JWT/Supabase Auth implementation is included.

### Chia: verified cash ingestion

Current supported internal input is `TrustedCashIngestion` (`db04-trusted-ingestion/1`,
`cash-source-v1`): exactly two documents, original bytes/filename and matching verified
CashSource objects. The registry is trusted server composition, not a client-selected
pair. The adapter independently hashes and normalizes bytes, verifies registered
BANK/LEDGER classification and compares the complete normalized evidence.

General C1/V2 input is intentionally unsupported. A future versioned bridge must prove
role/schema, exact amount/currency/direction, genuine VALUE_DATE or POSTING_DATE,
business/period agreement, producer batch and row lineage, accepted/warning/unresolved
separation, and organization ownership bound through Jason. Do not infer source role
from filenames, substitute transaction dates, cast V2 to C1 or treat a supplied
`organizationId` as authorization. Unsupported financial interpretations stay unsupported.

### Frontend: protected reads and processing identity

Use the internal facade result `db04-backend-read/1`, bound to the server processing
ID, job organization and BANK/LEDGER fingerprints. It includes transactions,
deterministic proposals, cases, rankings, proposalVerifications and financialViews
(cash analytics, reconciliation summary, forecast availability and report lineage).
All five read models must derive from that same authorized result. Monetary values
remain decimal strings. Scores and VERIFIED_SUGGESTION do not approve a transaction;
AI verification remains UNRESOLVED until an assignment policy is approved.

Main's browser `ProcessingContext` has a synthetic organization and runner literal,
distinct processing-ID formula and additional stage/history/anomaly outputs. It must
not be type-cast to the backend result. Agree an additive protected DTO/runner adapter
with Izzat before wiring real backend reads. No duplicate public API is added. Existing
scoped query/audit conventions remain available for the future authenticated route.

## Group Supabase and staging gate

No group database connection was made. The supplied project name is
FinGence-Production; no approved exact project reference, restricted catalog connection
or staging target is established in this worktree. Do not reuse personal FYP A access
or identify a target by its display name. The earlier screenshot is not available as
a verified group connection identity in this task.

Required next access: group owner confirms nonsecret project reference, database,
expected dedicated catalog-only role and inspection scope; supplies connection details
privately via ignored local configuration. Check target binding, TLS certificate,
actual login/membership privileges and read-only catalog permissions before inspection.
No private rows or privileged credentials as a substitute. No role creation implied.

Group catalog inspection must establish migration history/drift, foundation objects,
identity relations/types, RLS/ACLs/ownership and PostgreSQL version before producing
group SQL. Keep public DB01–03 structures/records intact. Resolve DB04 identity FKs,
principal/authorized_organization and actor-binding policy compatibility; preserve all
eleven forced-RLS tables, exact numeric types and append-only evidence. Do not blindly
replay local migrations or create M2/M3 authentication schemas on the group target.

Nominate an approved isolated staging project/branch and confirm any cost separately.
After identity/ingestion contracts and catalog verification, prepare exact staging SQL,
checksums/role grants/drift checks/recovery and failure plan for separate mutation
approval. Then run the registered synthetic vertical slice with restricted runtime,
actual offline E5, acknowledged commits, readback/reconnect/duplicate/concurrency,
cross-organization/lifecycle/RLS and five read-model checks. Production migration and
deployment remain a separate approval; the personal disposable backup waiver does not
apply to group Production.

## Verification

See `db04-group-test-results.json` for final counts and commands. Local PostgreSQL tests
create a new loopback-only cluster; they accept no hosted connection configuration.
Their synthetic M2 sessions test database behavior, not Jason's Production authentication.
Installed offline E5 is tested with `DB04_E5_SMOKE=1`; fresh environments without its
approved runtime/model must report those skips rather than claim inference.

Final DB04 suite: 84 passed, 0 failed, 0 skipped (24 native PostgreSQL tests).
Selected regression run: 791 passed, 0 failed, 21 skipped. Explicitly configuring
Windows PostgreSQL for 15 initially skipped existing native tests yielded 14 passed
and one pg_ctl crash/restart ETIMEDOUT. An isolated export of unchanged main reproduced
that same failure (7 passed, 1 failed). Latest unique outcomes across these runs are
809 passed, 1 baseline failure, 6 optional private-dataset skips; repeated tests are
not added twice. TypeScript, focused lint with zero warnings and server boundary pass.
No full-project passing claim is made; prior full-suite baseline failures remain separate.

No Production, Supabase Auth, Vercel, teammate branch, public financial record or frozen
research artifact was modified. This candidate implements contract-independent backend
reuse; group hosted installation and real ingestion/authentication remain blocked on
the interfaces above. Full project suite success is not claimed.
