# M5 — local operational identity and tenant administration

Development checkpoint, 31 October 2026. Stacked on M4 (`8445992`, Draft PR #27); not a
hosted release. `/data`, C1/C2, the M4 provider, quota ledger and authorization records are
unchanged. No V2 record is cast into C1. No live model request is made.

## Run

```sh
pnpm install --frozen-lockfile
pnpm m5:dev            # http://127.0.0.1:3185/admin — cookie fingence_m5_session
```

M5 layers on the M4 launcher hardening (provider dispatch flags cleared) and the same
checkout-relative `.local/m2-database-v1`. Stop the server before any OS-owner command:
only one process may open the local PGlite directory.

### OS-owner organization onboarding (no browser signup, no default accounts)

```sh
# Name and address are not secrets; no password is passed to the command.
M5_ORGANIZATION_NAME='Synthetic org' M5_ADMIN_EMAIL='admin@example.invalid' pnpm m5:organization create
```

The command prints the organization ID, invitation ID, expiry and the path of an owner-only
file `.local/m5-enrollment/<invitation>.url` (directory 0700, file 0600) holding the
one-time link. The code is never printed. Open the link, choose a password, then delete the
file. This first Admin membership is active: it is the OS owner's explicit grant.

| Command | Effect |
| --- | --- |
| `M5_ORGANIZATION_ID=… M5_ADMIN_EMAIL=… M5_RECOVERY_CONFIRM=<same ID> pnpm m5:organization recover-admin` | Replacement Admin code. Refused unless the confirmation matches and no Admin who can sign in remains. |
| `M5_ORGANIZATION_ID=… pnpm m5:organization deactivate` | Deactivates every membership, revokes every session and pending code, in one transaction. |
| `M5_ORGANIZATION_ID=… pnpm m5:organization activate` | Reactivates the organization only; nothing else is reinstated. |

## Administration workflows (`/admin`)

1. **Invite.** Address + one of exactly three roles → a single-use 256-bit code (only its
   SHA-256 is stored), valid 24 hours, superseding any earlier pending code for that address.
   The Admin can only copy the link; it is never rendered or shown again.
2. **Enroll.** The invitee opens `/enroll#code=…`. The fragment is never sent to a server and
   is removed from the address bar immediately; the code stays masked in memory. The invitee
   confirms the invited address and sets a password (12–128). Organization, role and address
   come from the code. Admin-issued codes create an **inactive** membership; no session is
   started. Every failure is the same generic refusal.
3. **Activate / change.** Activation, deactivation and role changes increment the membership
   version and revoke that member's sessions. Self-affecting or destructive changes confirm first.
4. **Revoke sessions** without changing the membership.
5. **Suspend / reactivate an account.** Separate from membership state; allowed only for
   accounts whose memberships are all in the Admin's organization. Suspension revokes every
   session and blocks sign-in on every route; reactivation restores sign-in only.
6. **Audit.** The latest 100 security events of this organization, with typed actions.

| Role | `/admin` | Financial views |
| --- | --- | --- |
| Finance | Explicit denial; API attempts are refused and audited | Verified own-organization views unchanged |
| Technical (Management) | Processing counts only | None |
| Admin | Members, roles, codes, sessions, accounts, audit | None (unchanged from M3) |

## Security contract

- Identity is server-resolved from the HttpOnly session. The admin API accepts exact typed
  keys only; organization, role-of-caller and actor claims are rejected. POST requires the
  exact loopback origin and a body ≤ 4 KiB. Production and Vercel deny every page and action.
- Authorized state conflicts return 409 with a code (`STALE_MEMBERSHIP`, `LAST_ADMIN_PROTECTED`,
  `ALREADY_MEMBER`, `STALE_ACCOUNT`, `STALE_INVITATION`, `INVITATION_UNAVAILABLE`); everything
  else is a generic 404. Another tenant's users and codes are indistinguishable from nonexistent ones.
- Every mutation and every authenticated denial commits its typed audit event in the same
  transaction; if the audit write fails, nothing commits. Refusals are committed outcomes, so
  their codes survive native PostgreSQL (which reports thrown errors as `PERSISTENCE_FAILED`).
- New audit actions: `membership.invited`, `membership.invitation_revoked`, `membership.enrolled`,
  `membership.activated`, `membership.deactivated`, `account.deactivated`, `account.reactivated`,
  `session.revoked`. The local installer widens the CHECK from the TypeScript allowlist; the
  hosted Phase 3 SQL is unchanged and rejects them (fail closed) until a reviewed migration.
- Account suspension is enforced inside `resolveM2Principal` and sign-in whenever
  `fingence_m5` exists, so every M2/M3/M4/M5 route honors it. With M5 enabled, the legacy M3
  `management`, `membership` and `revoke` actions delegate to the M5 service.
- Lock order: organization advisory lock → actor rows (`FOR NO KEY UPDATE`, never upgraded) →
  target sessions → target memberships → account suspension. M3 membership changes now share
  this core. The base M3 order (membership before sessions) deadlocked against a concurrent
  financial read on native PostgreSQL 18; that reproduction is retained as review evidence.
- Last-Admin protection counts active Admin memberships whose account is not suspended.
  Enrollment is serialized per organization and per address; a code redeems at most once.

Schema: `supabase/sql/v2-m5-local.sql` (`fingence_m5.account_suspensions`, `fingence_m5.invitations`),
additive and local only; RLS enabled; anon/authenticated have no access.

## Verification

```sh
pnpm test tests/tenant-admin-m5     # PGlite service/route + native PostgreSQL concurrency
pnpm test                           # full; native PG and configured Python/OCR when available
pnpm lint && pnpm typecheck && pnpm check:server-boundary
pnpm build
node scripts/verify-ai-production-isolation.mjs http://127.0.0.1:3118   # local next start only
pnpm audit --json
```

Native tests cover concurrent code redemption, suspension against an in-flight audited
financial read, sign-in racing suspension, Admin suspension racing Admin demotion,
self-demotion racing sign-out, enrollment racing organization deactivation, the M3/M5
session-first lock order, typed refusals and audit rollback.

## Limitations

- Local development only: not Production identity, hosted RLS or a least-privilege role.
  The local database owner can still modify audit rows (no append-only enforcement).
- Password reset and self-service password change are deferred. Addresses are globally unique,
  so a forgotten password has no in-app recovery yet.
- One active organization per identity (existing sign-in contract). A code for an address
  registered elsewhere fails generically at redemption.
- The existing sign-in limiter, and the new enrollment limiter, allow one attempt per second
  per server process across all users, not per account.
- Sign-in attempts by members without an active membership, and redemptions of unknown codes,
  are refused without an audit row (no organization can be attributed).
- The member overview refreshes on demand; session validity is re-checked every second.
- Durable job scheduling and recovery are the next, separate assignment.
