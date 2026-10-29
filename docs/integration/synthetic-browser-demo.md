# Local synthetic financial demonstration

Run from this checkout using Node 24.22.0 and pnpm 11.19.0:

```zsh
pnpm install --frozen-lockfile
read -s "FINGENCE_V2_I1_TOKEN?Local demo code (64 lowercase hexadecimal characters): "
export FINGENCE_V2_I1_TOKEN
pnpm demo:financial:local
```

Open `http://127.0.0.1:3171/ai-ingestion/synthetic-financial`. The launcher enforces the loopback bind and local enable flags; it rejects a missing code or Vercel environment. Enter the code once to start a local session. Do not use a real provider or financial credential as the demo code. Nothing writes it to an environment file, browser storage or Git.

The sign-in creates a random opaque session token held in an HttpOnly, SameSite=Strict cookie, scoped to this API, expiring in 30 minutes. Only its hash is stored in the disposable database. HTTP loopback uses no Secure cookie attribute. Every data operation resolves the session, active Finance membership and server-owned tenant. Upload, ownership assignment and audit happen atomically; scoped reads/calculation/report are audited before delivery. Local shared-code provisioning is not a production identity provider, user administration or complete RBAC. Technical (Management) and Admin do not gain financial calculation privileges.

Select an unchanged sample from `public/samples/ingestion`: `edge_cases.csv`, `bank_statement.xlsx`, or `ledger.csv`. Source hashes, server-chosen sample conventions, stable ingestion/C1 projection and grouped persistence are used. The browser never submits trusted amounts, roles, tenant IDs or verification claims. This is sample-constrained deterministic processing. No V2 outcome is cast to C1; no AI model runs.

For `edge_cases.csv`, expect 8 checked, 2 VALID, 3 WARNING, 3 REJECTED and 5 accepted. Calculation excludes all 3 warnings: `125.5 + (-20) = 105.5 MYR`. Report JSON and the supported question, “What is the sum of signed source amounts?”, share exact values and source references. Bank XLSX accepts 8 rows but its monetary basis does not support this sum. Revenue, expenses, cash flow, forecasting and live AI remain unavailable. Switching batches, changing files, reprocessing, signing out or losing session access clears prior displayed results. Download and supported questions reauthorize and recalculate before returning.

An authenticated event stream pushes acknowledged local session revocation immediately. A database session/membership change is detected by its one-second validation heartbeat; a broken channel clears the UI, with a five-second watchdog if a silent connection stalls. Browser scheduling and network delivery impose latency: this is not an absolute instantaneous revocation guarantee. Requests still fail closed at the database boundary. Sign out in a second tab to rehearse revocation in the first. Reload restores a valid cookie session and authorized batch list.

This database is in memory. Each runtime has a server-issued random generation; server restart discards all synthetic batches and sessions. New pending browser references store the operation UUID plus this generation before upload. Every upload is fenced to the active generation and active tenant session. A delayed upload from a discarded runtime cannot write into the new database. These correlation references confer no authorization.

After a lost response or JSON failure, **Check operation** recovers the original committed batch without processing again. Same-generation PROCESSING or UNKNOWN outcomes stay blocked and cannot be retired. If a POST never registered, explicitly archiving its reference installs a server tombstone after checking the attempt table; a delayed upload with that ID is then refused. A pre-fix bare UUID can be investigated and, only if absent from the current registry/database, explicitly fenced this way. No known or uncertain existing attempt is cleared.

After a server restart, sign in again and check the retained operation. RETIRED_GENERATION means the old temporary database is gone; it does not claim the old attempt never committed. **Archive reference without retry** reauthorizes against the current generation, preserves the original identity and receipt in browser reference history, then releases the pending marker using a cross-tab lock and compare-before-remove. Storage failure or a changed marker leaves processing blocked. No financial data or credentials are stored there. Archival never retries processing; any new execution requires explicitly selecting/processing a sample with a new ID. An unparseable marker is preserved for investigation rather than guessed or silently deleted.

Browser visual acceptance, including the actual JSON download on desktop/mobile and visible restart/revocation behavior, remains pending when Work browser automation is disabled. HTTP and storage-helper tests are separate evidence, not browser sign-off. Existing21 production restrictions are retained, plus the new retirement-action probe (22 total).

Native tests use fresh temporary clusters, never a configured/hosted database. Set `FINGENCE_TEST_PG_BIN` to the directory containing `initdb`/`pg_ctl`, then run `pnpm exec vitest run tests/persistence/grouped.postgres.test.ts tests/integration/local-session-sum.postgres.test.ts --maxWorkers=1`. macOS uses `/opt/homebrew/opt/postgresql@18/bin` by default; Windows supports `.exe`. The tests stop their own clusters. Production APIs remain disabled and hosted infrastructure requires separate authorization.
