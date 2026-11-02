# Recovery procedure and scope boundaries

## Executable synthetic drill

From this branch with existing Node 24/PostgreSQL 18 tools and installed offline E5:

```powershell
node scripts/db04-preparation/run.mjs
node scripts/db04-preparation/plan.mjs
```

The runner has no database/target arguments. It creates only owned temporary
clusters, seeds synthetic public/identity/reconciliation data, pg_dumps a custom
archive, verifies SHA256, rejects corrupt/reused targets, pg_restores atomically to
a fresh owned database and compares every row as PostgreSQL JSON text and effective
table ACL/RLS flags. It then authenticates a fresh synthetic capability and reads
the restored processing context. It also runs pg_basebackup, pg_verifybackup and
recovers an independent physical cluster with roles and forced RLS. Never point
these local methods at an existing cluster, edit their owned markers or substitute
a hosted URL. Reused DB03 source/provenance is recorded alongside the harness.

`outputs/db04-ai06/combined-recovery-summary.json` records archive/manifest hashes,
row-text/ACL digests, outcomes and safe cleanup status. It contains no restorable
backup or real financial data. Physical/WAL files and raw archives are excluded
from Git/ZIP. A successful lab is stopped and removed. A failed lab is stopped and
retained under its owned temporary root; do not delete protected recovery data or
reuse that destination. A failed checksum/restore must stop, not invoke a weaker
restore or --clean against an existing database.

## Before an actual FYP A migration

There is no verified hosted backup in this package. Owner must separately approve:
export identity, exact schema/data scope, protected destination, encryption/key
custody, retention/off-site copy, access, RPO/RTO and restore verification. The
inspection role cannot export financial data and must not be given those grants
as a shortcut. No export, hosted restore or paid plan/feature is authorized here.

For future approval, prepare an allowlisted custom-format pg_dump under a dedicated
approved backup/owner process with verify-full TLS, private CA and protected
password file/process configuration. Never put a URL or password in command
arguments, shell history or reports. Include the four public foundation tables,
dependent functions/sequences/indexes/policies/ACLs and required schema definitions;
after migration also include the private identity and DB04 data/schema. A schema-
only or RLS-filtered dump is not a data recovery backup. A missing/permission-denied
object is a failure, not a reason to weaken RLS or silently exclude it.

Supabase-managed auth/storage/extension scope must be decided explicitly with the
provider. Database exports do not contain Storage object bytes, uploaded source
files, external secrets, model caches or provider settings. Logical dumps exclude
global role definitions/passwords. Do not blindly replay pg_dumpall managed roles
or export role password hashes. Maintain a reviewed role/ownership/privilege
manifest without passwords, and provision required roles privately in the restore
lab before restore. The physical synthetic drill proves local tools, not access to
Supabase's physical backup/WAL system.

Protect real archives before writing: encrypted approved volume, current-user/
SYSTEM-only ACL on Windows, ignored location outside source/deployment tracing,
separate key custody and tested recovery of keys. Hash the complete archive and
its approved manifest; inventory scope, tool/server versions and capture time
without row contents or credentials. Metadata-only SHA256 is not proof of recovery.
No private hosted data may be copied into the synthetic lab without that separate
controlled-data authorization.

## Future separately approved restore verification

1. Use a new isolated, approved recovery destination. Match hosted PostgreSQL 17.11
   major/provider extensions and review owner/role compatibility. Current local
   tests run PostgreSQL 18; cross-major managed recovery is not certified.
2. Verify archive and manifest hashes and list contents privately. Reject missing
   scope/corruption. Provision reviewed prerequisite roles without exposed passwords.
3. Restore with pg_restore --exit-on-error --single-transaction into an unused
   destination. Never use --clean, overwrite or restore to live personal/team DB.
4. Compare scope counts and exact row digests from a separately approved consistent
   snapshot; preserve numeric text. Inspect constraints (including NOT VALID),
   orphan FKs, triggers, ownership, safe definer functions, policies/ACLs and roles.
   Reauthenticate with restricted identities and prove denial as well as access.
5. On synthetic approved records, verify source hashes, processing identity, exact
   financial values, immutable evidence, duplicate behavior and backend retrieval.
   Do not trigger emails, auth webhooks, external providers or production jobs.
6. Record RPO/RTO and scope exceptions. Only a completed independent drill can remove
   the hosted recovery blocker. Preserve failure diagnostics privately, stop the
   restored environment safely and request an explicit next action.

For migration failures before COMMIT, ROLLBACK stops that file. After a known COMMIT,
do not automatically retry/drop newly installed objects. Quiesce the proposed
development APIs (which remain disabled), assess exact partial state and obtain
approval for corrective DDL or verified restore. Recovery is not a substitute for
correct authorization, backups or financial-data preservation.
