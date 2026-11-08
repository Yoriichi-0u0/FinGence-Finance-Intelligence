import 'server-only';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase } from '../db/postgres';
import { SECURITY_AUDIT_ACTIONS } from '../security/audit';

/** Local-only. Requires the M2 and M3 schemas; idempotent on every startup. */
export async function installM5Schema(db: TransactionDatabase) {
    const sql = await readFile('supabase/sql/v2-m5-local.sql', 'utf8');
    if (!SECURITY_AUDIT_ACTIONS.every(action => /^[a-z_]+\.[a-z_]+$/.test(action)))
        throw new Error('INVALID_AUDIT_ALLOWLIST');
    await db.transaction(async (tx) => {
        for (const statement of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()))
            await tx.query(statement);
        // The TypeScript allowlist is the single source; existing rows only use earlier, retained values.
        const current = (await tx.query<{ definition: string }>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='security_audit_events_action_check' AND conrelid='public.security_audit_events'::regclass")).rows[0]?.definition ?? '';
        if (SECURITY_AUDIT_ACTIONS.every(action => current.includes(`'${action}'`)))
            return;
        await tx.query('ALTER TABLE public.security_audit_events DROP CONSTRAINT IF EXISTS security_audit_events_action_check');
        await tx.query(`ALTER TABLE public.security_audit_events ADD CONSTRAINT security_audit_events_action_check CHECK (action IN (${SECURITY_AUDIT_ACTIONS.map(action => `'${action}'`).join(',')}))`);
    });
}
