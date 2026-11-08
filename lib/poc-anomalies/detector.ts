import { fromCents, toCents, type SourceRow } from './source';

/**
 * Transparent rule baseline for review candidates. Thresholds were fixed before the offline
 * evaluation and are not tuned per run. A candidate is a reason to review, never a fraud finding.
 * Inputs are source rows only (description, direction, amounts, counterparty, reference, date).
 */
export const DETECTOR_VERSION = 'poc-anomaly-rules-v1';
export type Severity = 'HIGH' | 'MEDIUM';
export type RuleId = 'DUPLICATE_REFERENCE' | 'REFERENCE_FORMAT_IRREGULAR' | 'DIRECTION_CONFLICT' | 'UNUSUAL_DIRECTION_FOR_COUNTERPARTY' | 'AMOUNT_OUTLIER' | 'UNVERIFIED_COUNTERPARTY' | 'DESCRIPTION_COUNTERPARTY_MISMATCH';
export const RULES: Record<RuleId, { title: string; basis: string }> = {
    DUPLICATE_REFERENCE: { title: 'Duplicate reference', basis: 'The same reference appears on more than one row of this business.' },
    REFERENCE_FORMAT_IRREGULAR: { title: 'Irregular reference', basis: `The reference breaks the format used by at least 95% of this business's references.` },
    DIRECTION_CONFLICT: { title: 'Direction conflict', basis: 'The description tag or the signed amount contradicts the stated bank direction.' },
    UNUSUAL_DIRECTION_FOR_COUNTERPARTY: { title: 'Unusual direction', basis: 'This counterparty moves cash in one direction in at least 95% of 10 or more rows.' },
    AMOUNT_OUTLIER: { title: 'Amount outlier', basis: 'Modified z-score above 3.5 (median and MAD) among comparable rows.' },
    UNVERIFIED_COUNTERPARTY: { title: 'Unverified counterparty', basis: 'The bank description states that the counterparty is new or unverified.' },
    DESCRIPTION_COUNTERPARTY_MISMATCH: { title: 'Description mismatch', basis: 'The bank description does not mention the recorded counterparty.' },
};
export const THRESHOLDS = { robustZ: 3.5, highRobustZ: 7, counterpartyPeers: 8, directionRows: 10, directionShare: 0.95, referenceShare: 0.95 } as const;
export type Finding = { ruleId: RuleId; severity: Severity; rationale: string };
export type Candidate = { row: SourceRow; severity: Severity; findings: Finding[] };

const tokens = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const IGNORED = new Set(['test', 'the', 'and', 'sdn', 'bhd', 'of', 'for']);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const display = (cents: number) => fromCents(BigInt(Math.round(cents)));
function median(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function groupBy<T>(items: T[], key: (item: T) => string) {
    const map = new Map<string, T[]>();
    for (const item of items) { const k = key(item); const list = map.get(k); if (list) list.push(item); else map.set(k, [item]); }
    return map;
}

export function detectAnomalies(rows: SourceRow[]): Candidate[] {
    const findings = new Map<string, Finding[]>();
    const flag = (row: SourceRow, finding: Finding) => { const list = findings.get(row.rowId); if (list) list.push(finding); else findings.set(row.rowId, [finding]); };
    const business = (r: SourceRow) => `${r.businessId}\u0000${r.currency}`;
    const party = (r: SourceRow) => `${business(r)}\u0000${r.counterparty.toLowerCase()}`;
    const byBusiness = groupBy(rows, business), byParty = groupBy(rows, party), byDirection = groupBy(rows, r => `${business(r)}\u0000${r.direction}`);
    const byPartyDirection = groupBy(rows, r => `${party(r)}\u0000${r.direction}`);

    for (const group of byBusiness.values()) {
        const references = groupBy(group, r => r.reference.toUpperCase());
        const shapes = groupBy(group, r => /^[A-Z0-9]+$/.test(r.reference) ? `plain:${r.reference.length}` : 'other');
        const [dominant, conforming] = [...shapes.entries()].filter(([shape]) => shape !== 'other').sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
        const share = conforming.length / group.length, length = dominant.slice(6);
        for (const row of group) {
            const same = references.get(row.reference.toUpperCase())!;
            if (same.length > 1)
                flag(row, { ruleId: 'DUPLICATE_REFERENCE', severity: 'HIGH', rationale: `Reference ${row.reference} also appears on ${same.filter(r => r !== row).map(r => r.rowId).join(', ')}.` });
            if (share >= THRESHOLDS.referenceShare && !conforming.includes(row))
                flag(row, { ruleId: 'REFERENCE_FORMAT_IRREGULAR', severity: 'MEDIUM', rationale: `Reference ${row.reference} ${/dup/i.test(row.reference) ? 'carries a duplicate marker and ' : ''}differs from the ${length}-character alphanumeric format of ${Math.floor(share * 1000) / 10}% of ${row.businessId} references.` });
        }
    }
    for (const row of rows) {
        const tag = /^\[(debit|credit)\]/i.exec(row.description)?.[1]?.toLowerCase(), signed = toCents(row.signedAmount), amount = toCents(row.amount);
        if (tag && tag !== row.direction.toLowerCase())
            flag(row, { ruleId: 'DIRECTION_CONFLICT', severity: 'HIGH', rationale: `Description is tagged [${tag}] but the bank direction is ${row.direction}.` });
        else if ((row.direction === 'Credit' ? signed : -signed) !== amount)
            flag(row, { ruleId: 'DIRECTION_CONFLICT', severity: 'HIGH', rationale: `Signed movement ${row.signedAmount} is inconsistent with a ${row.direction} of ${row.amount}.` });
        if (/\bunverified\b|\bnew (?:unverified )?(?:vendor|payee|supplier)\b/i.test(row.description))
            flag(row, { ruleId: 'UNVERIFIED_COUNTERPARTY', severity: 'MEDIUM', rationale: `Bank description "${row.description}" identifies a new or unverified counterparty.` });
        const description = tokens(row.description), compact = description.join(''), names = tokens(row.counterparty).filter(t => t.length >= 3 && !IGNORED.has(t));
        if (names.length && !names.some(t => description.includes(t) || (t.length >= 4 && compact.includes(t))))
            flag(row, { ruleId: 'DESCRIPTION_COUNTERPARTY_MISMATCH', severity: 'MEDIUM', rationale: `Bank description "${row.description}" does not mention the recorded counterparty ${row.counterparty}.` });
    }
    for (const group of byParty.values()) {
        if (group.length < THRESHOLDS.directionRows) continue;
        const credits = group.filter(r => r.direction === 'Credit').length, majority = credits * 2 >= group.length ? 'Credit' : 'Debit';
        const count = majority === 'Credit' ? credits : group.length - credits;
        if (count / group.length < THRESHOLDS.directionShare) continue;
        for (const row of group.filter(r => r.direction !== majority))
            flag(row, { ruleId: 'UNUSUAL_DIRECTION_FOR_COUNTERPARTY', severity: 'MEDIUM', rationale: `${row.counterparty} is a ${majority.toLowerCase()} in ${count} of ${group.length} rows of ${row.businessId}; this row is a ${row.direction.toLowerCase()}.` });
    }
    const statistics = new Map<SourceRow[], { median: number; mad: number }>();
    const stats = (peers: SourceRow[]) => {
        let s = statistics.get(peers);
        if (!s) { const values = peers.map(r => Number(toCents(r.amount))), m = median(values); s = { median: m, mad: median(values.map(v => Math.abs(v - m))) }; statistics.set(peers, s); }
        return s;
    };
    for (const row of rows) {
        const own = byPartyDirection.get(`${party(row)}\u0000${row.direction}`)!, counterparty = own.length >= THRESHOLDS.counterpartyPeers;
        const peers = counterparty ? own : byDirection.get(`${business(row)}\u0000${row.direction}`)!, { median: m, mad } = stats(peers);
        if (!mad || peers.length < THRESHOLDS.counterpartyPeers) continue;
        const z = 0.6745 * (Number(toCents(row.amount)) - m) / mad;
        if (Math.abs(z) <= THRESHOLDS.robustZ) continue;
        flag(row, { ruleId: 'AMOUNT_OUTLIER', severity: Math.abs(z) >= THRESHOLDS.highRobustZ ? 'HIGH' : 'MEDIUM', rationale: `${row.currency} ${row.amount} is ${Math.abs(z).toFixed(1)} robust deviations ${z > 0 ? 'above' : 'below'} the median ${row.currency} ${display(m)} of ${plural(peers.length, row.direction.toLowerCase())} ${counterparty ? `with ${row.counterparty}` : `of ${row.businessId}`}.` });
    }
    return rows.filter(r => findings.has(r.rowId)).map(row => {
        const list = findings.get(row.rowId)!.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'HIGH' ? -1 : 1));
        return { row, severity: list[0].severity, findings: list };
    }).sort((a, b) => a.row.date.localeCompare(b.row.date) || a.row.rowId.localeCompare(b.row.rowId));
}
