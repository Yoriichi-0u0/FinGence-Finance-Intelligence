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
        return { identity, prerequisites, tables,
            // Catalog existence alone never proves hosted identity or target approval.
            hostedWritesAuthorized: false as const };
    });
}
