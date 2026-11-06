# FinGence workspace v1: organizations, three roles, autonomous processing

5 November 2026. FinGence processes documents **autonomously**. There is no approval or review step: every document is accepted
or refused by the deterministic gates, and every run is recorded automatically. People act only around the processing:

| Role | Who | Sees | Can do |
| --- | --- | --- | --- |
| **Finance** | A finance user who knows nothing technical | The front end: Data, Transactions, Reconciliation, Analytics, Forecasting, Anomalies, Reports, Q&A, in plain language | Process documents. Each completed run is recorded for the organization, with no click |
| **Management (Technical)** | Someone who can troubleshoot | Operations: every run, every document's decision, reason, failed checks, disclosures, conversion notes, model receipts (model, request ID, tokens, cost), who is signed in, the audit trail. Never the records or amounts | **Pause / resume** the organization's processing, with a reason Finance users see. **End anyone's session**, which stops that person's processing at once |
| **Admin** | Whoever manages access | Team (members, invitations), plus the sessions and audit trail in Operations | Invite (a one-time code, shown once, valid 72 h), change roles, turn access off, withdraw invitations, sign members out. One active Admin always remains |

Neither Management nor Admin processes documents or sees financial figures. An Admin's invitation is the only approval a
new member needs: the membership is active when the code is redeemed.

The **public demo** is unchanged: without a session, the Data page works with fictional documents and nothing is recorded.

## Storage and enforcement

`supabase/sql/workspace-v1.sql`, schema `fingence_workspace` in the FinGence-Production Supabase project:
`organizations` (with the processing pause), `members`, `invitations`, `sessions`, `audit`. `fingence_ingestion.runs`
gains `organization_id` and `member_id`.

- **Not exposed:** RLS is enabled and forced with no policies, and the schema is revoked from `anon` and `authenticated`.
  Every read and write is a `SECURITY DEFINER` function that only the service role may execute.
- **Role checks in the database:** every function that acts for a person takes the SHA-256 of their session token and checks
  the role and organization itself, so a server bug cannot widen access.
- **Secrets never stored:** passwords are hashed with scrypt on the server. Session tokens and invitation codes are 256-bit
  random values, and only their SHA-256 is stored.
- **Sessions:** an HttpOnly, SameSite=Lax cookie, Secure in production, valid 12 hours. A role change, turning access off, or ending a session
  takes effect on the next request.
- **Attempts:** sign-in and join are limited to 10 a minute per client and 30 an hour per email, in the shared counter store.

## Server

- `lib/server/workspace/store.ts`: configuration and the function-call transport.
  - On only with `FINGENCE_WORKSPACE=1` plus the ingestion store (`FINGENCE_INGESTION_STORE=1`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
- `lib/server/workspace/session.ts`:
  - `caller()` resolves who is making a request.
  - `processingRefusal()` is the gate on `/api/ai/interpret` and `/api/ai/ask`: no session means the public demo; an ended session gets 401; a role other than Finance gets 403; a paused organization gets 423.
- `lib/server/workspace/handlers.ts`: the route logic for `/api/workspace/{session,sign-in,sign-out,join,team,operations}`, and `POST /api/ingestion/runs`, which is Finance-only when the workspace is on.
- Pages: `/sign-in`, `/join`, `/team` (Admin), `/operations` (Management; Admin sees sessions and the audit trail). Each is a 404 when the workspace is off.

## Owner bootstrap

```bash
node scripts/workspace-owner-code.mjs "Organization name" admin@example.com
```

The command writes a one-time Admin code to `.local/workspace/` and prints only its hash and the SQL to run as the owner. The SQL is `select public.fingence_workspace_bootstrap(...)`. Then open `/join` with the code.

## Tests

`tests/workspace/workspace.test.ts` runs the real migration in PGlite through a PostgREST-shaped transport. It covers:

- joining, sign-in and attempt limits;
- every role boundary, checked by the server and again by the database;
- the service-role-only grants;
- tenant isolation;
- pausing and resuming;
- ending sessions;
- role and access changes;
- the last-Admin rule;
- the workspace switched off.
