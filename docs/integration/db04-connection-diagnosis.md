# DATABASE_UNAVAILABLE root-cause diagnosis

Start f1c67ddd694abe8a6bc11a6bb9552cb3f0060a37, same feature branch.

The failed operation is BROKER_POOL_ACQUISITION_AUTHENTICATION: raw pg.Pool.connect with the existing private broker URL returns SQLSTATE 28P01 (AUTHENTICATION_REJECTED). It occurs before a broker query, capability issuance or financial processing. Existing adapter catches pool acquisition errors and exposes DATABASE_UNAVAILABLE intentionally; this masks the underlying authentication category but is not evidence of a SQL/migration defect.

Runtime separately authenticates over verified TLS, confirms actual role/database, reads catalogs and sees all eleven forced-RLS reconciliation tables. Broker role metadata obtained through runtime is LOGIN enabled, no expiration, limit 2, no superuser/BYPASSRLS. Its configured direct host/database/user and TLS match the approved target. The supplied broker credentials are rejected. A mistyped/stale local password versus a different server-side password cannot be distinguished without privately checking the existing secret; no password hashes were read and no reset was attempted.

The diagnostic uses max 1 per pool and still receives 28P01. The application pool default is 4, exceeding the broker role's limit 2; that is a separate concurrency capacity issue, not this authentication error (not 53300). Do not broaden role limits or change shared adapter behavior to hide bad credentials. Future broker factory should size its dedicated pool to the approved limit before concurrent work.

New safeConnectionFailure utility permits only fixed stages, SQLSTATE/allowlisted network codes and categories; it drops messages, stacks, causes and all connection details. No raw error logging was introduced and no public endpoint exposes diagnostics.

Old install/first-test evidence remains unchanged. Reconciled state: both schema/seed commits acknowledged; password commands and private configuration reported completion; runtime login VERIFIED, broker login AUTHENTICATION_REJECTED, provisioning therefore NOT fully verified. PASSWORDS_PENDING is a historical stage, not the current final state. Do not label both passwords working based on terminal command success.

No hosted roles/passwords/grants/RLS/objects were changed, financial contents read, capabilities issued or financial operations run during diagnosis. Permissions remain as installed; no repair or retry with owner was attempted. Connection is NOT ready for the synthetic test. Next action is private verification/correction of the existing broker credential. If it is unavailable, a database password reset requires separate explicit approval. After authentication and security checks pass, resume the previously approved test as a separate execution, not part of this diagnosis.

Sanitized result files accompany this document. Main, teammates, team Production, Supabase Auth and Vercel remain untouched. No full-project test rerun; earlier baseline limitations remain.

Local verification: five classifier/sanitization tests passed, zero failed/skipped; TypeScript, focused lint and server-boundary checks passed. Initial sandbox Vitest launch failed before collection due to EPERM cache rename; approved unsandboxed local rerun passed. No financial or full-project test was rerun for this diagnostic.
