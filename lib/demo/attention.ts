import type { ProcessingContext } from './pipeline';

/**
 * What in one processing needs a person, counted once so the Overview's "Needs you" strip and the navigation badges
 * always agree: anomalies the books could not settle, reconciliation differences no stated rule explained, and documents
 * that were set aside. A processing without results has nothing to count.
 */
export function attentionCounts(c: ProcessingContext | null): { anomalies: number; reconciliation: number; documents: number } {
    if (!c?.scope || !c.outputs.reconciliation) return { anomalies: 0, reconciliation: 0, documents: 0 };
    const o = c.outputs;
    return {
        anomalies: o.anomalyResolution?.flagged ?? o.anomalies.length,
        reconciliation: o.resolution?.attention.length ?? c.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length,
        documents: c.quarantine.filter(q => q.kind === 'DOCUMENT' || q.kind === 'HISTORY').length,
    };
}
