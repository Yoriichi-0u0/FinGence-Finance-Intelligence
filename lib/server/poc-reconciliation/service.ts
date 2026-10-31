import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import type { ReconciliationScope } from '../../poc-anomalies/reconciliation';
import { resolveM3Principal } from '../financial-m3/management';
import { auditM2 } from '../ai-ingestion/m2/identity';
import type { FinancePoCReconciliationV1 } from '../../poc-reconciliation/contracts';
import { normalizeCashSource } from './normalize';
import { reconcileCashSources } from './match';
/** Hashes of the owner's two supplied synthetic inputs, not paths, labels or scoring answers. */
export const approvedPoCSourceHashes = Object.freeze({ bank: 'be27244c4924d55e2e1ef26de8b7e5f905e68ebe82164a284e42f40c74973d88', ledger: '947698e00aae209a7d6ad9731b321d1e56919d0454001c76bcebfc5b5681d77a' });
export async function installReconciliationSchema(db: TransactionDatabase) {
    const sql = await readFile('supabase/sql/finance-poc-local.sql', 'utf8');
    await db.transaction(async tx => { for (const s of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim())) await tx.query(s); });
}
export type ReconciliationSelection = { id: string; businessId: string; period: string; currency: string };
/** Read-only report bridge, called inside the caller's authorized/audited transaction.
 * Never select by month alone: another upload may contain the same month's rows.
 * Multiple ledger pairs are ambiguous until there is an explicit pair-selection contract.
 */
export async function readScopedReconciliation(tx: SqlConnection, principal: M2Principal, scope: ReconciliationScope): Promise<FinancePoCReconciliationV1 | null> {
    if (principal.role !== 'Finance' || principal.organization_id !== scope.organizationId || !/^[0-9a-f]{64}$/.test(scope.bankSha256)) return null;
    const rows = (await tx.query<{ snapshot: FinancePoCReconciliationV1 }>(
        `SELECT snapshot FROM fingence_poc.reconciliations
         WHERE organization_id=$1 AND bank_sha256=$2
           AND snapshot #>> '{scope,businessId}'=$3
           AND snapshot #>> '{scope,period}'=$4
           AND snapshot #>> '{scope,currency}'=$5
         LIMIT 2 FOR SHARE`,
        [principal.organization_id, scope.bankSha256, scope.businessId, scope.period, scope.currency],
    )).rows;
    return rows.length === 1 ? rows[0].snapshot : null;
}
/** Internal composition only. Alternate registered hashes are for isolated test fixtures, never browser input. */
export function createReconciliationService(db: TransactionDatabase, registered: Readonly<{ bank: string; ledger: string }> = approvedPoCSourceHashes) {
    return {
        async ingest(token: string, bankBytes: Uint8Array, ledgerBytes: Uint8Array, bankName: string, ledgerName: string) {
            // Verify access before parsing. Recheck with identity/membership/organization row locks in the write transaction.
            await db.transaction(tx => resolveM3Principal(tx, token));
            const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
            if (hash(bankBytes) !== registered.bank || hash(ledgerBytes) !== registered.ledger) throw Error('REGISTERED_POC_SOURCES_REQUIRED');
            const bank = normalizeCashSource(bankBytes, 'bank', bankName), ledger = normalizeCashSource(ledgerBytes, 'ledger', ledgerName);
            return db.transaction(async tx => {
                const p = await resolveM3Principal(tx, token), id = randomUUID();
                const snapshot = reconcileCashSources(p.organization_id, bank, ledger);
                const inserted = await tx.query<{ id: string }>('INSERT INTO fingence_poc.reconciliations(id,organization_id,created_by,bank_sha256,ledger_sha256,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(organization_id,bank_sha256,ledger_sha256) DO NOTHING RETURNING id::text', [id, p.organization_id, p.user_id, bank.sha256, ledger.sha256, JSON.stringify(snapshot)]);
                const existing = inserted.rows[0] ?? (await tx.query<{ id: string }>('SELECT id::text FROM fingence_poc.reconciliations WHERE organization_id=$1 AND bank_sha256=$2 AND ledger_sha256=$3', [p.organization_id, bank.sha256, ledger.sha256])).rows[0];
                if (!existing) throw Error('RESULT_UNCONFIRMED');
                await auditM2(tx, p, inserted.rows.length ? 'ingestion.persisted' : 'batch.read', existing.id);
                return { id: existing.id, snapshot };
            });
        },
        async list(token: string): Promise<ReconciliationSelection[]> {
            return db.transaction(async tx => {
                const p = await resolveM3Principal(tx, token);
                const rows = (await tx.query<ReconciliationSelection>('SELECT id::text,snapshot #>> \'{scope,businessId}\' AS "businessId",snapshot #>> \'{scope,period}\' AS period,snapshot #>> \'{scope,currency}\' AS currency FROM fingence_poc.reconciliations WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT 50', [p.organization_id])).rows;
                await auditM2(tx, p, 'batch.read', 'poc-source-pairs'); return rows;
            });
        },
        async get(token: string, id: string, download = false): Promise<FinancePoCReconciliationV1> {
            if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('ACCESS_DENIED');
            return db.transaction(async tx => {
                const p = await resolveM3Principal(tx, token);
                const row = (await tx.query<{ snapshot: FinancePoCReconciliationV1 }>('SELECT snapshot FROM fingence_poc.reconciliations WHERE id=$1 AND organization_id=$2 FOR SHARE', [id, p.organization_id])).rows[0];
                if (!row) throw Error('ACCESS_DENIED');
                await auditM2(tx, p, download ? 'report.downloaded' : 'batch.read', id); return row.snapshot;
            });
        },
    };
}
