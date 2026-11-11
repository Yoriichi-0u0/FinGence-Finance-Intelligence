# FinGence workspace: SAIC users only, three stacked roles

11 November 2026 (v2, replacing the 5 November v1 of organizations with Finance / Management / Admin). FinGence is for
SAIC users only. Processing is **autonomous**: every document is accepted or refused by the deterministic gates and every
run is recorded automatically; people act only around the processing.

| | Finance user | Admin | Superadmin |
| --- | --- | --- | --- |
| Process documents, use every finance page, export | ✅ | ✅ | ✅ |
| Invite, turn off or sign out Finance users | ❌ | ✅ | ✅ |
| Pause or resume processing (with a reason everyone sees) | ❌ | ✅ | ✅ |
| Operations: runs, each document's checks, failures and model receipts; who is signed in | ❌ | ✅ | ✅ |
| Add, change or remove Admins | ❌ | ❌ | ✅ |
| Full audit trail; turn the AI on or off | ❌ | ❌ | ✅ |
| See API keys or provider settings | ❌ | ❌ | ❌ |

- **Stacked:** each role includes everything the one below it may do.
- **Below your own level only:** a person invites, changes, turns off or signs out only people below their own role, and
  gives only roles below their own. Nobody changes their own role. Superadmin is never granted in the app: only the owner
  bootstrap issues a Superadmin code, so no one can remove the last Superadmin from inside the app either.
- **One organization:** the database refuses a second one.
- **Sign-in required everywhere:** there is no public demo once the workspace is on. `proxy.ts` sends a request without a
  session cookie to `/sign-in` (pages) or answers 401 (APIs); every data route then checks the session, role and
  organization in the database. Only `/sign-in`, `/join` and the sign-in/join/session/sign-out APIs are open.
- **AI switch:** when a Superadmin turns the AI off, `/api/ai/interpret` and `/api/ai/ask` answer 423 `AI_OFF`, and server
  jobs run with no model (known layouts by the rules; unfamiliar ones are set aside). Nothing is sent to the provider.
- **One pause switch:** server processing jobs belong to the signed-in member's organization, and the workspace pause is
  the only one. The env-gated `/management` console is off whenever the workspace is on.

## Storage and enforcement

`supabase/sql/workspace-v1.sql`, then `supabase/sql/workspace-v2-saic.sql`, schema `fingence_workspace` in the
FinGence-Production Supabase project (v1 applied on 4 November with 0 organizations; **v2 not yet applied**).

- **Not exposed:** RLS enabled and forced with no policies; the schema is revoked from `anon` and `authenticated`. Every
  read and write is a `SECURITY DEFINER` function that only the service role may execute.
- **Role checks in the database:** every function that acts for a person takes the SHA-256 of their session token and
  checks the role (`fingence_workspace.rank`) and organization itself, so a server bug cannot widen access.
- **Secrets never stored:** passwords hashed with scrypt on the server; session tokens and invitation codes are 256-bit
  random values, stored only as SHA-256.
- **Sessions:** HttpOnly, SameSite=Lax cookie, Secure in production, 12 hours. A role change, turning access off or
  ending a session takes effect on the next request.
- **Attempts:** sign-in and join are limited to 10 a minute per client and 30 an hour per email.
- **Audit:** joining, sign-in and sign-out, invitations, role and access changes, ended sessions, pause/resume and the
  AI switch are recorded with who did them.

## Server and pages

- `lib/server/workspace/store.ts`: configuration, roles and `atLeast`. On only with `FINGENCE_WORKSPACE=1` plus the
  ingestion store (`FINGENCE_INGESTION_STORE=1`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
- `lib/server/workspace/session.ts`: `caller()`, `requireRole(headers, minimum)`, `signedInMember()` and
  `processingGate()` (signed in, not paused, and with `{ ai: true }` the AI on).
- `lib/server/workspace/handlers.ts`: `/api/workspace/{session,sign-in,sign-out,join,team,operations}` and
  `POST /api/ingestion/runs` (any signed-in member when the workspace is on).
- Pages: `/sign-in`, `/join`; `/team` and `/operations` for Admins and Superadmins (checked on the server). Each is a 404
  when the workspace is off.

## Owner bootstrap

```bash
node scripts/workspace-owner-code.mjs "SAIC" superadmin@example.com
```

The command writes a one-time Superadmin code to `.local/workspace/` and prints only its hash and the SQL to run as the
owner (`select public.fingence_workspace_bootstrap(...)`). The first run creates the SAIC organization; later runs reuse it.
Then open `/join` with the code.

## Locally

`node scripts/dev-store.mjs` (a fresh store folder) loads the same migrations; run the app with `FINGENCE_WORKSPACE=1` and
`FINGENCE_WORKSPACE_LOCAL_URL=http://127.0.0.1:<port>`, and call the bootstrap function on that store.

## Tests

`tests/workspace/workspace.test.ts` runs both migrations in PGlite through a PostgREST-shaped transport: joining and
sign-in, no public demo, one organization, service-role-only grants, every role processing, each boundary of the role
ladder (server and database), session ending, access changes, pause and resume, and the AI switch.
`tests/workspace/proxy.test.ts` covers the sign-in proxy.
