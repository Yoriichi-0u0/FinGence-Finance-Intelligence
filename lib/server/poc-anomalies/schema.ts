import 'server-only';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase } from '../db/postgres';

/** Local-only. Requires the M2, M3 and M5 schemas (M5 widens the audit CHECK); idempotent on every startup. */
export async function installPocAnomalySchema(db: TransactionDatabase) {
    const sql = await readFile('supabase/sql/poc-anomalies-local.sql', 'utf8');
    await db.transaction(async (tx) => {
        for (const statement of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()))
            await tx.query(statement);
    });
}
