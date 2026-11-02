# DB04 and AI06 hosted development integration completed

Personal FYP A fhipzomczevbpybezzxu / postgres, starting commit
4943eb121d7911558094b914259c58c544e8a3b2. Scope is the separately approved isolated
synthetic development deployment, not real Production authentication or ingestion.

The previously saved broker credential was rejected. No valid replacement was
recoverable from the private configuration, so the owner-authorized reset changed
ONLY db04_dev_broker_login. A fresh 48-byte random password was generated privately,
stored in the existing protected ignored configuration, and provisioned as a SCRAM
verifier without sending cleartext password in SQL. No password, verifier, URL or
CA appears in evidence. Acknowledgement and subsequent successful TLS authentication
prove the reset worked. Runtime password and all roles/grants/RLS remained unchanged.

Dedicated createDevelopmentBrokerDatabase caps its pool at two, matching the broker
role limit, while reusing the existing verified-TLS configuration and transaction
adapter. The shared runtime pool remains unchanged. After reset, the private test
diagnostic's applicationPoolMax=4 describes the base adapter profile, not the
dedicated final backend broker factory, which overrides max to two. After reset, the private test
runner exposed a separate diagnostic bug: resolving a schema-qualified table name
in has_table_privilege requires schema access the broker deliberately lacks. The
precheck was changed to resolve catalog OIDs; no schema access grant was added.
That pre-processing failure is preserved separately from the successful final run.
No financial operation was retried after an uncertain commit.

## Actual hosted evidence

`db04-hosted-completion.json`: 21 checks passed, zero failed. Both restricted logins
authenticated over verified TLS. Broker cannot access financial tables; runtime
cannot issue capabilities. No PUBLIC/anon/authenticated/service_role financial
grants exist on the new tables; runtime without an issued capability sees no jobs.
All eleven reconciliation tables have RLS enabled AND forced.

The existing registered bank.csv and ledger.csv fingerprints were verified and
passed through createReconciliationBackend. Two accepted transactions, source
documents/references, deterministic VERIFIED_SUGGESTION proposals, fuzzy ranking,
actual installed offline E5 ranking and independent UNRESOLVED verification evidence
were committed and retrieved on hosted Supabase. No similarity proposal was
automatically financially approved. The exact cash total read back was MYR 6380.53.

Processing ID:
`a15395c79e003c92d7e186d39da2d3cf9cc92c9a57c2f1ed5689defa013bb325`.

All five read models are produced from that persisted context: transaction rows,
reconciliation/evidence, cash analytics, forecast availability and report lineage.
The single-month forecast remains unavailable; no forecast or accounting values
were invented. Reprocessing reused the same ID and two transactions. Both pools
were closed/recreated; fresh admission retrieved identical sources and independent
verification evidence. Another synthetic organization and expired authority were
denied. These are real hosted backend/read-model results, not a public HTTP/UI
deployment. Existing Phase 1 dashboard behavior is preserved.

## Scope and limitations

Only the approved private identity/reconciliation schemas received synthetic rows.
No existing public financial records were read/modified, installations/seeds rerun,
RLS disabled, permissions broadened, owner used as runtime or public routes enabled.
Public metadata equality was recorded during installation; this task does not
claim a content-level digest comparison of existing private records, which were
not read. Backup waiver remains explicit; Git is not a database backup.

Synthetic Finance admission in a dedicated test-mode CLI is NOT Supabase Auth or
Jason's Production solution. General Chia C1/V2 classification, VALUE_DATE and
ownership mapping remain separate. Team Production, main, teammates, Supabase Auth,
Vercel and frozen AI evidence are unchanged. No Production/team integration claim.
Original stopped-run and pending-stage evidence remains preserved; this result
supersedes it without rewriting history. Detailed secrets/configuration stay ignored.

Local reconciliation regressions: 150 passed, 0 failed, 0 skipped, including 58
native PostgreSQL tests and actual offline E5. Focused pool/TLS tests: 3/0/0,
overlapping that suite. TypeScript, focused lint, server-boundary and whitespace
checks passed. Full project not rerun; earlier 30 unchanged-main failures remain
disclosed. Raw local report: outputs/db04-ai06/hosted-completion-local-regressions.json.
