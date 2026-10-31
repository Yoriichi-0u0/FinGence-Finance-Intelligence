# M3 — connected V2 financial consumers (local experimental)

Issue #24, stacked on the accepted M2 source `d5796b5`. This is a feature-branch
capability, not a merged or hosted release. `/data` and C1/C2 remain unchanged.

## Run

Use Node 24.22.0 / pnpm 11.19.0 from the M3 checkout. Frozen install:

```sh
pnpm install --frozen-lockfile
pnpm m3:dev
```

Open `http://127.0.0.1:3183/ai-ingestion`. M3 uses its own checkout-relative
`.local/m2-database-v1` and `fingence_m3_session` cookie; the existing M2 launcher
and cookie remain separate. Do not run two database owners against this directory.
Stop the server before OS-local account or organization commands.

For an initial **Admin**, set `M2_LOCAL_EMAIL`, `M2_LOCAL_ORGANIZATION` and
`M3_LOCAL_ROLE=Admin`. Read/export `M2_LOCAL_PASSWORD` privately (12–128 characters;
never put its value in documentation, command history or a committed file), then:

```sh
pnpm m3:account
unset M2_LOCAL_PASSWORD
```

The command prints only the new user/org IDs and membership-active status. To enroll
Finance or Technical (Management) in that organization, use a new identity, set
`M3_LOCAL_ORGANIZATION_ID` to the returned ID and `M3_LOCAL_ROLE` accordingly.
Enrollment starts **inactive**. Sign in as the org Admin at `/transactions` and
activate the membership. The final active Admin cannot demote/deactivate itself.
A role/activation change increments the membership version and revokes its sessions.
Session-only revocation is also available. A new sign-in is explicit, never automatic.
The existing sign-in limiter requires at least one second between attempts.

Organization lifecycle is OS-local only:

```sh
# Server stopped; M3_LOCAL_ORGANIZATION_ID must identify the local synthetic org.
pnpm m3:organization deactivate
pnpm m3:organization activate
```

Deactivation revokes all sessions and memberships atomically. Reactivation does not
reinstate them; a separately authorized OS/database-owner recovery is needed if no
active Admin remains. No browser organization-administration or hosted signup exists.
Only one active organization per identity is supported by the existing login contract.

## Connected workflow and contracts

1. Upload a registered synthetic CSV/XLSX/PDF/image in the existing automatic M2
   workspace. Interpretation is visibly **SIMULATED**, not fresh LLM inference.
2. Extraction → independent verifier → sealed V2 persistence and tenant-owned attempt.
   Rejected/unresolved outcomes remain separate. No V2 record is cast into C1.
3. Follow **Open connected Transactions, Analytics and Reports**. One shared selected
   attempt + warning policy is restored across these actual application views.
4. `createFinancialConsumers(database)` exposes `list`, `snapshot`, `export`, `answer`.
   Every financial read rechecks session, active membership, membership version,
   active organization, attempt ownership and durable audit in one transaction.
5. `v2-financial-consumers-v1` contains selected exact records/evidence, source identity,
   policy/conventions, receipt origin, coverage counts, descriptive analytics and
   publication-ineligible capability states. Its SHA-256 selection proof is identical
   in table/chart/report/answer. The export omits the principal identity.
6. The browser stores **selection hints only**, scoped by server user/org, and never
   trusts them as authorization. It clears results on selection/access changes and
   polls/revalidates session access every second and on window focus. Navigation,
   refresh and downloads reauthorize; unknown/missing/denied batches never become zero.

Local-only HTTP composition is under `/api/ai-ingestion/m2/consumers`:

- GET: batch list, selected snapshot, `action=export`, `action=management`.
- POST: `action=question`; scoped Admin `membership` and `revoke`.
- All requests require development + explicit AI/M2/M3/I1 flags, non-Vercel runtime,
  loopback host and existing HttpOnly session. Mutations require same origin and
  bounded JSON. Browser-supplied tenant/user/financial-verification claims are rejected.
- Hosted Production denies these methods even if local flags are mistakenly set.
  Hosted Transactions/Analytics/Reports keep their existing illustrative fallbacks.

### Roles

| Role | Local capabilities | Denied |
| --- | --- | --- |
| Finance | Own-org verified batches, exact calculations, reports, deterministic questions | Membership administration, other tenants |
| Technical (Management) | Own-org processing-state counts only | Financial values/evidence and membership lists/mutations |
| Admin | Own-org membership/role changes, session revocation, operational counts | Financial tables/calculations/exports, other tenants, hosted infrastructure |

Admin is not an implicit financial role. Passwords reuse the existing salted scrypt
KDF. This is local session-backed access, **not Production-ready identity or RLS**.
Native anon/authenticated roles cannot access the added schema; the local database
owner still has privileged access. Hosted least-privilege deployment needs separate review.

## Supported financial meaning

Exact decimal strings are summed by **currency and monetary basis**, never across
currencies. `SOURCE_SIGNED_AMOUNT_SUM` is not revenue, expense, profit, net income or
cash flow. General-ledger debit/credit amounts cannot be converted to signed bank
movements. Daily/monthly source sums require verified transaction-date conventions
for every included record. Pixel ratios use BigInt scaling, not floating-point money.

The mixed CSV has four source rows: 2 VALID, 1 WARNING, 1 REJECTED; three verified.
Exclude warnings: 2 selected / **105.5 MYR**. Include warnings: 3 / **85.5 MYR**.
Ledger `i02.xlsx`: two WARNING records; no supported source-signed total.
`synthetic/m3/currency-months.csv`: five synthetic rows, MYR **0.25**, USD **0.01**;
the USD calculation cancels amounts beyond JavaScript's safe-integer range exactly.
Monthly/day totals and all source references use the same selected rows.

Reconciliation is unavailable without a verified counterpart/matching policy.
Forecasting is unavailable without adequate history and a validated model. These
states are tested; no mock predictions or economic labels are supplied.
`prepareGroundedRequest` / `validateGroundedClaims` prepare exact allowlisted numerical
claims and citations. No provider transport is invoked. Questions currently support
source-signed sums and selected record counts; other financial concepts abstain.

## Verification / coordination

```sh
pnpm test tests/financial-m3
pnpm test                         # configured Python/OCR, workbook and native PG when available
pnpm lint
pnpm typecheck
pnpm check:server-boundary
pnpm build
node scripts/verify-ai-production-isolation.mjs http://127.0.0.1:3118
pnpm audit --json
```

Native tests start a disposable loopback PostgreSQL cluster from
`FINGENCE_TEST_PG_BIN` (default Homebrew PostgreSQL 18). They distinguish real lock
waiting from PGlite evidence; absent binaries are explicit skips. The tests cover
session/membership/ownership/org revocation, concurrent Admin versions, audit failure
and a one-connection pool. Existing C1/C2, P2, six-format and M2 tests remain enabled.
The artifact checker must run from a neutral build path: a checkout nested under
`.local` is itself classified private. Do not relax this checker.

Chia owns this composition; Celester's #6 ownership/persistence and Jason's #8
session/audit contracts are reused. Frederick #7 owns future validated financial
methods; Izzat #9 can consume this shared versioned snapshot/UI. No teammate branch
is merged or rewritten. Future hosted identity, economic policy, real-model evaluation,
reconciliation and forecasting are separate authorization/implementation boundaries.
