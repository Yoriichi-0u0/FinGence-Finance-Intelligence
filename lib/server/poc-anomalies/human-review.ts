import 'server-only';
import type { SqlConnection } from '../db/postgres';
import type { M2Principal } from '../ai-ingestion/m2/identity';
import type { FinancePoCReconciliationV1 } from '../../poc-anomalies/reconciliation';
import { readReconciliationReviewAggregate } from '../poc-reconciliation/reviews';

/**
 * Read-only report bridge to the existing human review aggregate, inside the caller's authorized,
 * audited transaction. Exactly one persisted reconciliation must match the organization, scope,
 * bank SHA-256 and ledger SHA-256; anything else is reported as unavailable, never as zero decisions.
 */
export async function readReportReviewAggregate(tx: SqlConnection, principal: M2Principal, snapshot: FinancePoCReconciliationV1): Promise<unknown> {
    if (principal.role !== 'Finance' || principal.organization_id !== snapshot.scope.organizationId) return null;
    const rows = (await tx.query<{ id: string }>(
        `SELECT id::text FROM fingence_poc.reconciliations
         WHERE organization_id=$1 AND bank_sha256=$2 AND ledger_sha256=$3
           AND snapshot #>> '{scope,businessId}'=$4
           AND snapshot #>> '{scope,period}'=$5
           AND snapshot #>> '{scope,currency}'=$6
         LIMIT 2 FOR SHARE`,
        [principal.organization_id, snapshot.sources.bank.sha256, snapshot.sources.ledger.sha256, snapshot.scope.businessId, snapshot.scope.period, snapshot.scope.currency],
    )).rows;
    if (rows.length !== 1) return null;
    try { return await readReconciliationReviewAggregate(tx, principal, rows[0].id); }
    // Stored annotations that do not belong to this snapshot's outcomes. Database errors still propagate.
    catch (error) { if (error instanceof Error && error.message === 'REVIEW_DATA_UNAVAILABLE') return null; throw error; }
}
