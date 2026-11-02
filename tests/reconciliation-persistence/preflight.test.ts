import { it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PGlite } from '@electric-sql/pglite';
import { inspectReconciliationPrerequisites } from '../../lib/server/reconciliation/preflight';
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
    } finally { await pg.close(); }
});
