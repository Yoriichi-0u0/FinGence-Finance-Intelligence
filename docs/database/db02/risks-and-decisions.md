# DB02 — defect, risk and decision register

| ID | Finding and evidence | Classification | Treatment / owner |
| --- | --- | --- | --- |
| D02-01 | Native READ COMMITTED competing warning deletions both committed with zero remaining issues | Verified existing invariant defect | Fixed locally by DB02-001; regression passes at three isolation levels. Production application awaits migration review |
| R02-02 | Privileged counter edits can preserve the row CHECK while disagreeing with actual records | Demonstrated enforcement boundary, not a defect in the initial writer | Writer recount is retained; read-only audit detects drift. Celester/SAIC must define immutability or coherent mutation/recount protocol before mutation APIs |
| R02-03 | Positive attempt dataset_count/FKs do not independently prove child cardinality/completeness | Demonstrated application-owned invariant | Current group creation is atomic; investigation can return UNRESOLVED. No speculative cross-table trigger or auto-recount; lifecycle/recovery owner decision |
| R02-04 | SQL permits terminal-to-PROCESSING, ACTIVE-to-FAILED and other shape-valid updates | Missing approved lifecycle state-machine policy | Documented matrix; defer new transition constraints to Celester + SAIC |
| R02-05 | Self-FK prevents direct self-supersession, not longer cycles or multiple replacements | Undefined supersession contract | No replacement workflow invented. SAIC/Celester must define version identity, active population and transition actors |
| R02-06 | Failure rolls back parent/children, so no durable FAILED/job history survives | Existing transactional contract and future operational requirement | Preserve all-or-nothing semantics. Separate durable incident/job history needs a reviewed producer/security contract |
| R02-07 | Lost acknowledgement cannot establish commit outcome from transport alone | Confirmed adapter contract | No retry. Investigate same primary under attempt fence. Native tests cover real committed data with suppressed acknowledgement and pre-transmission failure without commit |
| R02-08 | No-op parent updates add tuple/WAL/check overhead; multi-record mutation deadlocks remain possible | Migration cost and concurrency limit | Focused local write probe captured; production contention/vacuum/CDC assessment remains deployment review |
| R02-09 | Source-row identity and producer/dataset IDs are not economic uniqueness keys | Intentional lineage/identity contract | Preserve duplicates across independent attempts; no finance deduplication or global dataset uniqueness added |
| R02-10 | Direct source lineage strings/hash shape do not prove authentic original file contents | Application validator / upstream trust boundary | Existing trusted-engine validation retained; no archive or transport-validation system added |
| R02-11 | Legacy unsafe filenames may exist under a NOT VALID financial filename CHECK | Intentional backward compatibility | No historical normalization or validation migration silently applied; separate retention/provenance decision |
| R02-12 | The earlier untracked architecture assessment was absent at initial DB02 inspection | Input availability limit | Do not restore or overwrite it. Audit actual implementation and committed DB01 report; note missing input |
| R02-13 | Existing DB01 working-tree integrity test fails because checkout converted artifact LF to CRLF | Pre-existing local evidence checkout limitation, independent of DB02 | Keep byte-exact hashing and all DB01 files untouched. Existing Git-blob verifier passes all 389 committed artifacts and 14 sources. A separate artifact checkout policy decision is needed; no line-ending normalization performed |

## Decisions before new functionality

SAIC/Celester must agree lifecycle transitions, correction/reprocessing/supersession and counter mutation policies. Chia owns the future producer/verified-output contract and candidate/rejection identity. Jason owns authorization, durable audit and tenancy/runtime role design. Frederick owns financial population/interpretation rules; Izzat owns future dashboard/report consumption. This review does not specify their modules or expand HTTP APIs.

Do not reinterpret COMPLETED_EMPTY as AI unresolved, failed processing or verified accounting accuracy. Do not introduce automatic retries for UNKNOWN or ROLLBACK_UNCONFIRMED. Do not change monetary signs, substitute dates, turn NULL into zero or infer currency conversion from operational count checks.
