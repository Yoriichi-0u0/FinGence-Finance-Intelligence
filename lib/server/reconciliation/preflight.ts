import 'server-only';
import type { TransactionDatabase } from '../db/postgres';

/** Catalog-only inspection. Never installs local identity schemas on a hosted target. */
export async function inspectReconciliationPrerequisites(db: TransactionDatabase) {
    return db.transaction(async tx => {
        await tx.query('SET TRANSACTION READ ONLY');
        const identity = (await tx.query(`SELECT current_database() AS database,
            current_user AS role, r.rolsuper, r.rolbypassrls,
            current_setting('server_version') AS version
            FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
        const required = ['fingence_m2.organizations', 'fingence_m2.users',
            'fingence_m2.memberships', 'fingence_m2.sessions',
            'fingence_m3.organization_states'];
        const prerequisites = [];
        for (const relation of required) {
            const row = (await tx.query<{ present: boolean }>(
                'SELECT to_regclass($1) IS NOT NULL AS present', [relation])).rows[0];
            prerequisites.push({ relation, present: row.present });
        }
        const tables = (await tx.query(`SELECT c.relname AS name,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='fingence_reconciliation' AND c.relkind='r'
            ORDER BY c.relname`)).rows;
        const columns = (await tx.query(`SELECT table_schema,table_name,column_name,data_type,
            is_nullable FROM information_schema.columns
            WHERE table_schema IN ('fingence_m2','fingence_m3','fingence_reconciliation')
            ORDER BY table_schema,table_name,ordinal_position`)).rows;
        const constraints = (await tx.query(`SELECT n.nspname AS schema,c.relname AS relation,
            x.conname AS name,x.contype AS type,x.convalidated AS validated,
            pg_get_constraintdef(x.oid) AS definition FROM pg_constraint x
            JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('fingence_m2','fingence_m3','fingence_reconciliation')
            ORDER BY n.nspname,c.relname,x.conname`)).rows;
        const functions = (await tx.query(`SELECT p.proname AS name,p.prosecdef AS security_definer,
            p.proconfig AS configuration,pg_get_userbyid(p.proowner) AS owner,
            p.proacl::text AS permissions FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='fingence_reconciliation' ORDER BY p.proname`)).rows;
        const extensions = (await tx.query('SELECT extname AS name,extversion AS version FROM pg_extension ORDER BY extname')).rows;
        const policies = (await tx.query(`SELECT tablename,policyname,roles,cmd,qual,with_check
            FROM pg_policies WHERE schemaname='fingence_reconciliation'
            ORDER BY tablename,policyname`)).rows;
        return { identity, prerequisites, tables, columns, constraints, functions, extensions, policies,
            // Catalog existence alone never proves hosted identity or target approval.
            hostedWritesAuthorized: false as const };
    });
}
