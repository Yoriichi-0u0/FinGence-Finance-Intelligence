# DB03 risk and operational decision register

| ID | Verified finding / limit | Status and next decision |
| --- | --- | --- |
| R03-01 | Logical, physical and PITR recovery pass for a tiny synthetic local schema | Verified local result; production scale, dependencies and target service readiness need separate tests |
| R03-02 | pg_ctl can report readiness while recovery still accepts only read-only connections | Implemented gate waits until pg_is_in_recovery is false, then verifies boundary/data and write compatibility |
| R03-03 | Logical restore uses NULL/default table ACL catalog representation instead of the explicit default owner ACL | Retained raw evidence, verified identical effective ACLs/ownership and real client denial; not byte-identical logical catalogs |
| R03-04 | A valid physical manifest does not prove a usable database | Actual copied-cluster startup and full financial/schema checks are mandatory and passed |
| R03-05 | PITR depends on the necessary base/WAL chain and explicit target | Named-target inclusion/exclusion proved locally. Archive gaps, retention and remote/off-site continuity require operational design |
| R03-06 | Plain temporary backups are intentionally synthetic and unencrypted | No real data allowed. Encryption, access controls, separate keys and off-site/immutable copies are future requirements |
| R03-07 | Successful lab backups are removed; only metadata/evidence remains | This repository cannot restore the deleted lab from its evidence. It is not a production backup repository |
| R03-08 | Dynamic writer UUIDs/timestamps and WAL positions vary between fresh runs | Inputs/marker IDs are controlled; exact source/restore equality is required within each run, not identical archives across different runs |
| R03-09 | Historical DB01 artifact files have a CRLF working-copy distinction | Exact committed blobs and source conventions are verified; historical files are not normalized or rewritten |
| R03-10 | The original architecture assessment is absent in the initial checkout | Not reconstructed or overwritten. Actual schema/DB02 report/native infrastructure inspected |
| R03-11 | Production RPO/RTO, retention, drill frequency and recovery authority are unknown | SAIC/deployment owner must approve; measured milliseconds do not establish a service SLA |
| R03-12 | Native roles, archive settings and data-directory access are controlled only in the lab | No managed Supabase capability, entitlement or access claim; provider-specific recovery remains unassessed |
| R03-13 | Two stopped development labs retain raw synthetic resources for diagnosis | Exact locations documented in runbook; outside Git; later deletion only after ownership/path/state verification |
| R03-14 | Checksums do not provide off-site resilience or independent authenticity | Production manifests/key custody and backup access must be designed separately |
| R03-15 | Financial restore reproduces existing invariants, including application-owned count/lifecycle limits | Recovery does not repair pre-existing drift, define supersession, add authentication or retry unknown commits |

No schema defect requiring a production migration was discovered. The implementation corrections were local tooling/test issues: Windows COPY path escaping, SQL alias syntax, restricted Git PATH, distinguishing effective default ACLs from catalog representation, and gating promotion readiness. No production write logic, old migration, security module, API or financial semantic was changed.
