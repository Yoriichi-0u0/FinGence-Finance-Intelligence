# DB04 / AI06 connected backend facade

Start e4b810b46034aecca9ab837f000ebd67a720bed6. Fetched main is still
cb5db4625ceca1cb94867a90a8a3edddbcf1e6ba (Phase 1 synthetic browser demo).
Its /data page selects DemoDataWorkspace and its CashSource contract remains
separate from C1/V2. The demo identifiers are not silently adopted as persisted
DB04 processing identities. Existing DB04 POST/GET are equivalent local-only
routes: they explicitly deny hosted connections. No duplicate route was created.

New internal createReconciliationBackend composes the existing hosted admission
boundary, trusted CashSource pipeline, DB04 services and financialViews. process
executes persistence → deterministic/fuzzy/optional real E5 → independent evidence
→ authorized stored read → five-view model. get returns the same stored context
under a new admission. Neither method accepts an organization override or returns
a capability. The caller owns/cleans up the separate broker and financial pools.
Transaction behavior, duplicate fences and uncertain-COMMIT handling are reused.
No algorithms, thresholds, schemas, public APIs or Production pages changed.

The combined native lab now invokes this facade after real E5 and compares its
processing ID, exact cash total, source lineage and verification history on read.
Existing tests cover duplicate/concurrent writes, rollback, reconnection/restored
reads, restricted RLS and lifecycle denial. The test authority is explicitly
synthetic. There is no real hosted Auth verifier or financial route deployment.

Hosted execution remains NOT PERFORMED this cycle. The smallest next step is
separate authorization for a protected backup/export and restore verification
scope. No hosted financial export is currently authorized or verified. The exact
subsequent validation/DB02/identity/DB04 SQL and hashes remain in
db04-combined-approval-manifest.json, unchanged. Jason's authority/mapping/revocation
decisions gate identity deployment. Do not skip these gates to demonstrate a write.
No hosted financial write/read success is claimed. PostgreSQL 18 synthetic tests
do not certify PostgreSQL 17.11 managed recovery or full migration compatibility.
