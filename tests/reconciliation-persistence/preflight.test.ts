import { it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PGlite } from '@electric-sql/pglite';
import { inspectReconciliationPrerequisites } from '../../lib/server/reconciliation/preflight';
import {assessHostedReadiness} from '../../lib/server/reconciliation/hosted-readiness';
it('inspects real catalogs without manufacturing missing hosted identity dependencies', async () => {
    const pg = await PGlite.create();
    try {
        const result = await inspectReconciliationPrerequisites({close: async () => {},
            transaction: work => pg.transaction(tx => work({query: async (sql, values) => {
                const r = await tx.query(sql, values);
                return {rows:r.rows,rowCount:r.affectedRows ?? r.rows.length} as never;
            }}))});
        expect(result.prerequisites).toHaveLength(5);
        expect(result.prerequisites.every(p => !p.present)).toBe(true);
        expect(result.tables).toEqual([]);
        expect(result.hostedWritesAuthorized).toBe(false);
        expect(result.functions).toEqual([]);
        expect(result.policies).toEqual([]);
        expect(result.extensions.some(e => e.name === 'plpgsql')).toBe(true);
        const readiness=assessHostedReadiness(result);expect(readiness.hostedDeploymentAuthorized).toBe(false);
        expect(readiness.blockers).toContain('IDENTITY_COLUMN_MISSING_OR_INCOMPATIBLE:fingence_m2.sessions.token_hash');
        expect(readiness.blockers).toContain('HOSTED_IDENTITY_CONTRACT_REQUIRED');
        expect(result.foundationCompatibility.missingFoundationTables).toHaveLength(4);
        expect(result.foundationCompatibility.hostedWritesAuthorized).toBe(false);
    } finally { await pg.close(); }
});
