import { RULES, type Candidate, type RuleId } from '../poc-anomalies/detector';
import type { ReconciliationResult } from '../reconciliation/reconcile';

/**
 * Autonomous anomaly resolution (FinGence processes without human review). A rule finding on a bank record is a
 * reason to look, not a conclusion. The business's own books are the independent witness: when the reconciliation
 * shows the same record booked in the cash-account ledger, with the same signed amount, the transaction is known to
 * the business and the candidate is resolved. Otherwise it is flagged, to the technical team, never to Finance.
 */
export const ANOMALY_RESOLUTION_VERSION = 'fingence-anomaly-resolution-v1' as const;
export type AnomalyResolution = 'CORROBORATED_BY_BOOKS' | 'FLAGGED';
export type BookedAs = { ledgerRecordIds: string[]; how: 'MATCHED' | 'MATCHED_LATE' | 'MATCHED_BY_AMOUNT' | 'TIMING_CLEARED' };
export type ResolvedAnomaly = Candidate & { resolution: AnomalyResolution; rule: string; summary: string; booked: BookedAs | null };
export type AnomalyOutcome = { version: typeof ANOMALY_RESOLUTION_VERSION; items: ResolvedAnomaly[]; corroborated: number; flagged: number; summary: string; rules: string[] };

/** A finding the books cannot settle: the bank record contradicts itself, whatever the ledger says. */
const SELF_CONTRADICTION: RuleId[] = ['DIRECTION_CONFLICT'];
const HOW: Record<BookedAs['how'], string> = { MATCHED: 'matched', MATCHED_LATE: 'matched a few days apart', MATCHED_BY_AMOUNT: 'matched by amount and date', TIMING_CLEARED: 'recorded in another month as a timing difference' };
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const amount = (currency: string, signed: string) => `${currency} ${Number(signed.replace('-', '')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Where each bank record went in the reconciliation: booked (and how), or not in the books. */
function bookings(layer: ReconciliationResult) {
    const booked = new Map<string, BookedAs>();
    for (const p of layer.periods) {
        for (const r of p.snapshot.results) if (r.bankRecordId && (r.status === 'MATCH_EXACT' || r.status === 'MATCH_DATE_SHIFT')) booked.set(r.bankRecordId, { ledgerRecordIds: r.ledgerRecordIds, how: 'MATCHED' });
        for (const i of p.items) {
            // A ledger item cleared by a bank record in a month only the bank covers carries the link on the ledger side.
            if (!i.bankRecordId) {
                if ((i.resolution === 'TIMING_CLEARED' || i.resolution === 'MATCHED_LATE') && i.link?.side === 'BANK' && i.ledgerRecordIds.length && !booked.has(i.link.recordId))
                    booked.set(i.link.recordId, { ledgerRecordIds: i.ledgerRecordIds, how: i.resolution === 'MATCHED_LATE' ? 'MATCHED_LATE' : 'TIMING_CLEARED' });
                continue;
            }
            if (i.resolution === 'MATCHED_BY_AMOUNT' && i.ledgerRecordIds.length) booked.set(i.bankRecordId, { ledgerRecordIds: i.ledgerRecordIds, how: 'MATCHED_BY_AMOUNT' });
            else if ((i.resolution === 'MATCHED_LATE' || i.resolution === 'TIMING_CLEARED') && i.link?.side === 'LEDGER') booked.set(i.bankRecordId, { ledgerRecordIds: [i.link.recordId], how: i.resolution === 'MATCHED_LATE' ? 'MATCHED_LATE' : 'TIMING_CLEARED' });
        }
    }
    return booked;
}

export function resolveAnomalies(candidates: Candidate[], layer: ReconciliationResult | null): AnomalyOutcome {
    const booked = layer ? bookings(layer) : new Map<string, BookedAs>();
    const reconciledMonths = new Set(layer?.scope.months ?? []);
    const items = candidates.map((c): ResolvedAnomaly => {
        const r = c.row, what = `${r.direction === 'Credit' ? 'Receipt' : 'Payment'} of ${amount(r.currency, r.signedAmount)} ${r.direction === 'Credit' ? 'from' : 'to'} ${r.counterparty} on ${longDate(r.date)}`;
        const why = c.findings.map(f => RULES[f.ruleId].title.toLowerCase()).join(', ');
        const contradiction = c.findings.find(f => SELF_CONTRADICTION.includes(f.ruleId));
        const b = booked.get(r.rowId) ?? null;
        if (contradiction) return { ...c, resolution: 'FLAGGED', booked: b, rule: 'The bank record contradicts itself (direction conflict); the books cannot settle that.', summary: `${what}: the bank record contradicts itself (${why}). Flagged for your technical team.` };
        if (b) return { ...c, resolution: 'CORROBORATED_BY_BOOKS', booked: b, rule: `Recorded in the cash-account ledger with the same signed amount (${HOW[b.how]}: ${b.ledgerRecordIds.join(', ')}).`, summary: `${what} looked unusual (${why}), but your books record it (${b.ledgerRecordIds.join(', ')}), so it is a known transaction. No action needed.` };
        const noLedger = !reconciledMonths.has(r.period);
        return { ...c, resolution: 'FLAGGED', booked: null, rule: noLedger ? 'No ledger was supplied for this month, so the books cannot confirm the record.' : 'The books do not record this transaction, so nothing confirms it.', summary: `${what} looked unusual (${why}) and ${noLedger ? 'no ledger covers that month' : 'your books do not record it'}. Flagged for your technical team.` };
    });
    const flagged = items.filter(i => i.resolution === 'FLAGGED').length, corroborated = items.length - flagged;
    const summary = !items.length ? 'No rule found anything unusual in the bank records.'
        : `${items.length} unusual bank record${items.length === 1 ? '' : 's'} checked against your books: ${corroborated} confirmed as known transaction${corroborated === 1 ? '' : 's'}${flagged ? `, ${flagged} flagged for your technical team` : '. Nothing needs your attention'}.`;
    return {
        version: ANOMALY_RESOLUTION_VERSION, items, corroborated, flagged, summary,
        rules: [
            'Every bank record is screened by transparent rules (duplicate or irregular reference, direction conflict, unusual direction, amount outlier, unverified counterparty, description mismatch). A finding is a reason to look, not a fraud finding.',
            'A finding is resolved when the reconciliation shows the same record in the cash-account ledger with the same signed amount: the business has recorded the transaction.',
            'A record the books do not show, a month without a ledger, or a bank record that contradicts itself is flagged for the technical team.',
        ],
    };
}
