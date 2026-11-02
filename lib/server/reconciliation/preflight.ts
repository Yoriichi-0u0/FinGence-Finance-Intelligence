import 'server-only';
import type { TransactionDatabase } from '../db/postgres';
import {inspectFoundationCatalog,assessFoundationCompatibility} from './foundation-catalog';

/** Catalog-only inspection. Never installs local identity schemas on a hosted target. */
export async function inspectReconciliationPrerequisites(db: TransactionDatabase) {
    return db.transaction(async tx => {
        await tx.query('SET TRANSACTION READ ONLY');
        const identity = (await tx.query(`SELECT current_database() AS database,
            current_user AS role, r.rolsuper, r.rolbypassrls,
            current_setting('server_version') AS version,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
            current_setting('transaction_read_only') AS transaction_read_only,
            EXISTS(SELECT 1 FROM pg_roles privileged WHERE (privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreaterole)
              AND pg_has_role(current_user,privileged.oid,'MEMBER')) AS privileged_membership
            FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
        const required = ['fingence_m2.organizations', 'fingence_m2.users',
            'fingence_m2.memberships', 'fingence_m2.sessions',
            'fingence_m3.organization_states'];
        const prerequisites = [];
        for (const relation of required) {
            const row = (await tx.query<{ present: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname||'.'||c.relname=$1 AND c.relkind IN ('r','p')) AS present`, [relation])).rows[0];
            prerequisites.push({ relation, present: row.present });
        }
        const tables = (await tx.query(`SELECT c.relname AS name,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='fingence_reconciliation' AND c.relkind='r'
            ORDER BY c.relname`)).rows;
        const columns = (await tx.query(`SELECT n.nspname AS table_schema,c.relname AS table_name,
            a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p')
            AND (n.nspname IN ('fingence_m2','fingence_m3','fingence_reconciliation')
              OR n.nspname='public' AND c.relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts','security_audit_events'))
            ORDER BY n.nspname,c.relname,a.attnum`)).rows;
        const constraints = (await tx.query(`SELECT n.nspname AS schema,c.relname AS relation,
            x.conname AS name,x.contype AS type,x.convalidated AS validated,
            pg_get_constraintdef(x.oid) AS definition FROM pg_constraint x
            JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('fingence_m2','fingence_m3','fingence_reconciliation')
            ORDER BY n.nspname,c.relname,x.conname`)).rows;
        const functions = (await tx.query(`SELECT p.proname AS name,p.prosecdef AS security_definer,
            p.proconfig AS configuration,pg_get_userbyid(p.proowner) AS owner,
            p.proacl::text AS permissions,
            EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='fingence_reconciliation' ORDER BY p.proname`)).rows;
        const extensions = (await tx.query('SELECT extname AS name,extversion AS version FROM pg_extension ORDER BY extname')).rows;
        const policies = (await tx.query(`SELECT tablename,policyname,roles,cmd,qual,with_check
            FROM pg_policies WHERE schemaname='fingence_reconciliation'
            ORDER BY tablename,policyname`)).rows;
        const permissions=(await tx.query(`SELECT n.nspname AS schema,c.relname AS relation,
            has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
            has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS can_write
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind IN ('r','p') AND (n.nspname IN ('fingence_m2','fingence_m3','fingence_reconciliation')
              OR n.nspname='public' AND c.relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts','security_audit_events'))
            ORDER BY n.nspname,c.relname`)).rows;
        const triggers=(await tx.query(`SELECT c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,
            pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='fingence_reconciliation'
            ORDER BY c.relname,t.tgname`)).rows;
        const indexes=(await tx.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
            WHERE schemaname='fingence_reconciliation' ORDER BY tablename,indexname`)).rows;
        const runtimeRole=(await tx.query(`SELECT rolname,rolsuper,rolbypassrls,rolcanlogin,rolcreaterole,rolcreatedb
            FROM pg_roles WHERE rolname='fingence_reconciliation_runtime'`)).rows;
        const runtimePermissions=(await tx.query(`SELECT c.relname AS relation,
            has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
            has_table_privilege(r.oid,c.oid,'UPDATE,DELETE,TRUNCATE,TRIGGER') AS excess_mutation
            FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE r.rolname='fingence_reconciliation_runtime' AND n.nspname='fingence_reconciliation' AND c.relkind='r' ORDER BY c.relname`)).rows;
        const foundation=await inspectFoundationCatalog(tx);
        return { identity, prerequisites, tables, columns, constraints, functions, extensions, policies,permissions,triggers,indexes,runtimeRole,runtimePermissions,foundation,foundationCompatibility:assessFoundationCompatibility(foundation),
            // Catalog existence alone never proves hosted identity or target approval.
            hostedWritesAuthorized: false as const };
    });
}

/** Enforce actual identity, not a read-only-sounding username. Metadata queries never call auth functions. */
export async function inspectWithRestrictedIdentity(db:TransactionDatabase,expected:{database:string;role:string}) {
    // Reject runtime/owner identities using catalog OIDs before resolving protected schema names.
    const gate=await db.transaction(async tx=>{
        await tx.query('SET TRANSACTION READ ONLY');
        return (await tx.query<{allowed:boolean}>(`SELECT current_database()=$1 AND current_user=$2
          AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
          AND NOT EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole) AND pg_has_role(current_user,p.oid,'MEMBER'))
          AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind IN ('r','p') AND (n.nspname IN ('fingence_m2','fingence_m3','fingence_reconciliation')
              OR n.nspname='public' AND c.relname IN ('ingestion_batches','financial_records','validation_issues','persistence_attempts','security_audit_events'))
            AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) AS allowed
          FROM pg_roles r WHERE r.rolname=current_user`,[expected.database,expected.role])).rows[0]?.allowed===true;
    });
    if(!gate)throw Error('READ_ONLY_INSPECTION_IDENTITY_REQUIRED');
    const report=await inspectReconciliationPrerequisites(db),r=report.identity;
    if(!r||r.database!==expected.database||r.role!==expected.role||r.rolsuper||r.rolbypassrls||r.rolcreatedb||r.rolcreaterole||r.rolreplication||r.privileged_membership||r.transaction_read_only!=='on'||report.permissions.some(p=>p.can_write))throw Error('READ_ONLY_INSPECTION_IDENTITY_REQUIRED');
    return report;
}
