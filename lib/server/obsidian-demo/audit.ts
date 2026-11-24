import 'server-only';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { QueryResult, SqlConnection } from '../db/postgres';
type PgTransaction = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows: number }> };

let databasePromise: Promise<Awaited<ReturnType<typeof PGlite.create>>> | undefined;

async function memoryDatabase() {
    databasePromise ??= (async () => {
        const database = await PGlite.create();
        await database.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
        let migration = await readFile(resolve('supabase/sql/phase3-security-audit-upgrade.sql'), 'utf8');
        migration = migration.replace(/^\s*--.*$/gm, '').replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
        for (const statement of migration.split(';').map(s => s.trim()).filter(Boolean)) await database.exec(statement);
        return database;
    })();
    return databasePromise;
}

/** The local demo writes through the application's audit module into a process-local, in-memory audit table. */
export async function auditVaultRetrieval(input: { requestId: string; outcome: 'success' | 'failure' }): Promise<void> {
    const database = await memoryDatabase();
    await database.transaction(async (transaction: PgTransaction) => {
        const connection: SqlConnection = {
            async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>> {
                const result = await transaction.query(sql, values);
                return { rows: result.rows as Row[], rowCount: result.affectedRows ?? result.rows.length };
            },
        };
        await persistSecurityAuditEvent(connection, {
            actorId: null, organizationId: null, action: 'financial_record.read', outcome: input.outcome,
            targetType: null, targetId: null, requestId: input.requestId, approvalId: null,
        });
    });
}
