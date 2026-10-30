import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { TransactionDatabase } from '../../lib/server/db/postgres';
import { installM2Schema } from '../../lib/server/ai-ingestion/m2/pipeline';
import { installM3Schema } from '../../lib/server/financial-m3/management';
import { installM5Schema } from '../../lib/server/tenant-admin-m5/schema';

export const password = 'Public-synthetic-M5-password';

/** Disposable PGlite database with the real M2 → M3 → M5 local schema chain. */
export async function m5Database() {
    const pg = await PGlite.create();
    await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
    await pg.exec(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
    const db: TransactionDatabase = { close: async () => { }, transaction: work => pg.transaction(tx => work({ query: async (sql, values) => { const r = await tx.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never; } })) };
    await installM2Schema(db);
    await installM3Schema(db);
    await installM5Schema(db);
    return { pg, db };
}

/** Rejects every durable audit insert so atomic rollback can be observed. */
export const failingAudit = (db: TransactionDatabase): TransactionDatabase => ({ close: db.close, transaction: work => db.transaction(tx => work({ query: (sql, v) => sql.includes('INSERT INTO public.security_audit_events') ? Promise.reject(new Error('audit failure')) : tx.query(sql, v) })) });
