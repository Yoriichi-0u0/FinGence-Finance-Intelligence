/**
 * Proposed bank reconciliation statement over one reconciliation snapshot. Every exception the matcher left
 * open is classified by a stated, deterministic rule into a standard reconciling item and placed on the bank
 * side (timing items the bank has not yet processed) or the ledger side (items the books lack or misstate).
 * Exact cents throughout. It PROPOSES: matcher outcomes stay as recorded, nothing is cleared or posted, and an
 * exception no rule explains stays UNEXPLAINED with its full effect on the difference.
 *
 * Movement basis: the snapshot holds the period's cash movements, not opening and closing balances, so the
 * statement reconciles bank movement to ledger movement for the period.
 */
import { groupDigits } from '../poc-anomalies/format';
import { fromCents, toCents as cents } from '../poc-anomalies/source';
import type { CashSourceRow, FinancePoCReconciliationV1, ReconciliationStatus } from './contracts';

export const STATEMENT_VERSION = 'fingence-reconciliation-statement-v1';
export const ITEM_CATEGORIES = ['DEPOSIT_IN_TRANSIT', 'UNPRESENTED_CHEQUE', 'BANK_CHARGE_NOT_IN_LEDGER', 'RECEIPT_NOT_IN_LEDGER', 'PAYMENT_NOT_IN_LEDGER', 'LEDGER_AMOUNT_ERROR', 'DUPLICATE_LEDGER_POSTING', 'REFERENCE_ONLY', 'UNEXPLAINED',
    // Assigned only by the reconciliation layer (lib/reconciliation), which links exceptions across days and months.
    'LATE_MATCH', 'PAYMENT_IN_TRANSIT', 'LEDGER_POSTED_LATE', 'CLEARED_PRIOR_PERIOD_ITEM',
    // One transaction the bank shows more than once under the same reference, recorded once in the ledger.
    'DUPLICATE_BANK_MATCHED', 'DUPLICATE_BANK_PAYMENT', 'DUPLICATE_BANK_RECEIPT'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];
export const CATEGORY_LABEL: Record<ItemCategory, string> = {
    DEPOSIT_IN_TRANSIT: 'Deposit in transit', UNPRESENTED_CHEQUE: 'Unpresented cheque', BANK_CHARGE_NOT_IN_LEDGER: 'Bank charge not in the ledger',
    RECEIPT_NOT_IN_LEDGER: 'Receipt not in the ledger', PAYMENT_NOT_IN_LEDGER: 'Payment not in the ledger', LEDGER_AMOUNT_ERROR: 'Ledger amount differs from the bank',
    DUPLICATE_LEDGER_POSTING: 'Duplicate ledger posting', REFERENCE_ONLY: 'Reference differs (no amount effect)', UNEXPLAINED: 'Unexplained',
    LATE_MATCH: 'Matched, recorded days apart', PAYMENT_IN_TRANSIT: 'Payment not yet cleared by the bank', LEDGER_POSTED_LATE: 'Recorded in the ledger in a later month',
    CLEARED_PRIOR_PERIOD_ITEM: 'Clears an item from an earlier month',
    DUPLICATE_BANK_MATCHED: 'Matched (the bank shows it more than once)', DUPLICATE_BANK_PAYMENT: 'Duplicate payment on the bank statement', DUPLICATE_BANK_RECEIPT: 'Duplicate receipt on the bank statement',
};
/** Days at the end of the period within which an unbanked ledger receipt is treated as in transit. */
export const IN_TRANSIT_DAYS = 3;
const CHEQUE = /\b(cheques?|chq|checks?|cek)\b/i;
const BANK_CHARGE = /\b(charges?|fees?|commission|caj|yuran|stamp duty)\b/i;

export type StatementItem = {
    category: ItemCategory; side: 'BANK' | 'LEDGER' | 'NONE'; status: ReconciliationStatus;
    /** Signed cents added to that side's movement. */
    adjustment: string;
    /** This exception's effect on bank − ledger, from the records alone (independent of the classification). */
    effect: string;
    bankRecordId: string | null; ledgerRecordIds: string[]; date: string; reference: string; description: string;
    rule: string; note: string | null;
};
export type StatementCheck = { id: string; label: string; passed: boolean; detail: string };
export type ReconciliationStatement = {
    version: typeof STATEMENT_VERSION; period: string; currency: string; basis: 'PERIOD_MOVEMENT';
    bank: { movement: string; items: StatementItem[]; adjusted: string };
    ledger: { movement: string; items: StatementItem[]; adjusted: string };
    other: StatementItem[];
    unexplained: string; explained: boolean; checks: StatementCheck[];
};

const MATCHED = new Set<ReconciliationStatus>(['MATCH_EXACT', 'MATCH_DATE_SHIFT']);
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const signed = (c: bigint) => (c < 0n ? '-' : '') + fromCents(c < 0n ? -c : c);
export const money = (c: bigint, currency: string) => `${c < 0n ? '−' : ''}${currency} ${groupDigits(fromCents(c < 0n ? -c : c))}`;

/**
 * Which of several identical copies of one record on the other side FinGence keeps: the date closest to that record's
 * date, then the lowest record ID. Used for ledger copies of one bank record (the others are reversed) and for bank
 * copies of one ledger entry (the others are duplicates). Deterministic, so no human choice is needed.
 */
export function duplicateChoice(bank: CashSourceRow, ledger: CashSourceRow[]): { kept: CashSourceRow; reversed: CashSourceRow[] } {
    const gap = (r: CashSourceRow) => Math.abs(Date.parse(r.date) - Date.parse(bank.date));
    const [kept, ...reversed] = [...ledger].sort((a, b) => gap(a) - gap(b) || a.recordId.localeCompare(b.recordId));
    return { kept, reversed: reversed.sort((a, b) => a.recordId.localeCompare(b.recordId)) };
}

/**
 * The matcher gives every bank record of an ambiguous reference group the same ledger candidates, so when the bank shows
 * a reference more than once those ledger records appear in several results. Each is listed on one statement item only:
 * - one ledger entry and identical bank amounts: one transaction the bank shows more than once. The bank copy chosen
 *   by `duplicateChoice` is its match; every other copy is a duplicate the ledger lacks;
 * - anything else: no pairing is safe. The ledger records go on the first bank record's item, and all stay unexplained.
 */
type SharedRole = { role: 'KEPT' | 'DUPLICATE'; kept: CashSourceRow; ledger: CashSourceRow; copies: CashSourceRow[] } | { role: 'SHARED'; ledger: CashSourceRow[] };
function sharedCandidates(snapshot: FinancePoCReconciliationV1, bankRows: Map<string, CashSourceRow>, ledgerRows: Map<string, CashSourceRow>): Map<string, SharedRole> {
    const groups = new Map<string, string[]>();
    for (const r of snapshot.results) if (r.status === 'AMBIGUOUS_DUPLICATE_LEDGER' && r.bankRecordId && r.ledgerRecordIds.length)
        groups.set(r.ledgerRecordIds.join('|'), [...(groups.get(r.ledgerRecordIds.join('|')) ?? []), r.bankRecordId]);
    const roles = new Map<string, SharedRole>();
    for (const [key, ids] of groups) {
        if (ids.length < 2) continue;
        const banks = ids.map(id => bankRows.get(id)).filter((x): x is CashSourceRow => !!x).sort((a, b) => a.recordId.localeCompare(b.recordId));
        const ledger = key.split('|').map(id => ledgerRows.get(id)).filter((x): x is CashSourceRow => !!x);
        if (banks.length !== ids.length) continue;
        if (ledger.length === 1 && banks.every(b => b.signedCents === ledger[0].signedCents)) {
            const { kept } = duplicateChoice(ledger[0], banks);
            for (const b of banks) roles.set(b.recordId, { role: b === kept ? 'KEPT' : 'DUPLICATE', kept, ledger: ledger[0], copies: banks });
        } else banks.forEach((b, i) => roles.set(b.recordId, { role: 'SHARED', ledger: i ? [] : ledger }));
    }
    return roles;
}

function classify(r: FinancePoCReconciliationV1['results'][number], bank: CashSourceRow | undefined, ledger: CashSourceRow[], period: string, currency: string, shared?: SharedRole): Omit<StatementItem, 'effect' | 'status' | 'bankRecordId' | 'ledgerRecordIds'> {
    const b = bank ? BigInt(bank.signedCents) : 0n, l = ledger.map(x => BigInt(x.signedCents)), row = bank ?? ledger[0];
    const base = { date: row?.date ?? '', reference: row?.reference ?? '', description: row?.description ?? '', note: null as string | null };
    const unexplained = (rule: string) => ({ ...base, category: 'UNEXPLAINED' as const, side: 'NONE' as const, adjustment: '0.00', rule });
    if (shared?.role === 'SHARED') return unexplained('Several bank records share the same ledger candidates, which are not one identical transaction: no pairing is safe.');
    if (shared) {
        const note = `Bank records ${shared.copies.map(x => x.recordId).join(', ')} carry the same reference and amount; the ledger records it once (${shared.ledger.recordId}). ${shared.kept.recordId} is its match (date closest to the ledger entry, then lowest ID); ${shared.copies.filter(x => x !== shared.kept).map(x => x.recordId).join(', ')} ${shared.copies.length === 2 ? 'is a duplicate' : 'are duplicates'}.`;
        if (shared.role === 'KEPT') return { ...base, category: 'DUPLICATE_BANK_MATCHED', side: 'NONE', adjustment: '0.00', note, rule: 'One of several identical bank records under the reference of a single ledger entry: the copy closest to the ledger date is its match.' };
        return b > 0n
            ? { ...base, category: 'DUPLICATE_BANK_RECEIPT', side: 'LEDGER', adjustment: signed(b), note, rule: 'Bank credit repeating another bank record that the single ledger entry already matches: the ledger needs the second receipt, to be refunded.' }
            : { ...base, category: 'DUPLICATE_BANK_PAYMENT', side: 'LEDGER', adjustment: signed(b), note, rule: 'Bank debit repeating another bank record that the single ledger entry already matches: the ledger needs the second payment, to be recovered.' };
    }
    switch (r.status) {
        case 'LEDGER_ONLY': {
            const v = l[0] ?? 0n, day = Number(base.date.slice(8, 10));
            if (ledger.length === 1 && v > 0n && base.date.startsWith(period) && day > lastDay(period) - IN_TRANSIT_DAYS)
                return { ...base, category: 'DEPOSIT_IN_TRANSIT', side: 'BANK', adjustment: signed(v), rule: `Ledger receipt dated in the last ${IN_TRANSIT_DAYS} days of the period with no bank record: added to the bank side until the bank credits it.` };
            if (ledger.length === 1 && v < 0n && CHEQUE.test(`${base.description} ${base.reference}`))
                return { ...base, category: 'UNPRESENTED_CHEQUE', side: 'BANK', adjustment: signed(v), rule: 'Ledger payment described as a cheque with no bank record: deducted on the bank side until the cheque is presented.' };
            return unexplained(v > 0n ? `Ledger receipt with no bank record, dated before the last ${IN_TRANSIT_DAYS} days of the period: not treated as in transit.` : 'Ledger payment with no bank record that is not described as a cheque.');
        }
        case 'BANK_ONLY': {
            if (b < 0n && BANK_CHARGE.test(base.description)) return { ...base, category: 'BANK_CHARGE_NOT_IN_LEDGER', side: 'LEDGER', adjustment: signed(b), rule: 'Bank debit described as a charge or fee with no ledger entry: the ledger needs the charge.' };
            if (b > 0n) return { ...base, category: 'RECEIPT_NOT_IN_LEDGER', side: 'LEDGER', adjustment: signed(b), rule: 'Bank credit with no ledger entry: the ledger needs the receipt.' };
            return { ...base, category: 'PAYMENT_NOT_IN_LEDGER', side: 'LEDGER', adjustment: signed(b), rule: 'Bank debit with no ledger entry: the ledger needs the payment.' };
        }
        case 'AMOUNT_MISMATCH_REVIEW': {
            if (!bank || ledger.length !== 1) return unexplained('Amount mismatch without exactly one bank and one ledger record.');
            const d = b - l[0], abs = d < 0n ? -d : d;
            return { ...base, category: 'LEDGER_AMOUNT_ERROR', side: 'LEDGER', adjustment: signed(d), rule: 'Same reference, different amounts: the ledger is corrected to the bank statement amount (confirm against the source document).',
                note: `Bank ${money(b, currency)}, ledger ${money(l[0], currency)}; difference ${money(abs, currency)}${abs % 9n === 0n ? ', divisible by 9, which is typical of transposed digits' : ''}.` };
        }
        case 'AMBIGUOUS_DUPLICATE_LEDGER': {
            if (!bank || ledger.length < 2 || l.some(v => v !== b)) return unexplained('Several candidates that are not identical copies of one bank amount.');
            return { ...base, category: 'DUPLICATE_LEDGER_POSTING', side: 'LEDGER', adjustment: signed(-b * BigInt(ledger.length - 1)), rule: `One bank record and ${ledger.length} identical ledger entries: the ${ledger.length - 1 === 1 ? 'extra entry is' : 'extra entries are'} reversed.`,
                note: (({ kept, reversed }) => `Ledger entries ${ledger.map(x => x.recordId).join(', ')} carry the same reference and amount. ${kept.recordId} is kept (posting date closest to the bank record, then lowest ID); ${reversed.map(x => x.recordId).join(', ')} ${reversed.length === 1 ? 'is' : 'are'} reversed.`)(duplicateChoice(bank, ledger)) };
        }
        case 'REFERENCE_MISMATCH_REVIEW':
            if (bank && ledger.length === 1 && b === l[0]) return { ...base, category: 'REFERENCE_ONLY', side: 'NONE', adjustment: '0.00', rule: 'Same date and amount with different references: no amount effect; the pairing still needs confirmation.' };
            return unexplained('Reference mismatch whose amounts also differ.');
        default: return unexplained('Not a supported exception status.');
    }
}

export function buildStatement(snapshot: FinancePoCReconciliationV1): ReconciliationStatement {
    const { period, currency } = snapshot.scope;
    const bankRows = new Map(snapshot.rows.bank.map(r => [r.recordId, r])), ledgerRows = new Map(snapshot.rows.ledger.map(r => [r.recordId, r]));
    const shared = sharedCandidates(snapshot, bankRows, ledgerRows);
    const items: StatementItem[] = snapshot.results.filter(r => !MATCHED.has(r.status)).map(r => {
        const bank = r.bankRecordId ? bankRows.get(r.bankRecordId) : undefined, role = r.bankRecordId ? shared.get(r.bankRecordId) : undefined;
        // A ledger record several bank records share is listed (and counted) on one item only.
        const ledger = !role ? r.ledgerRecordIds.map(id => ledgerRows.get(id)).filter((x): x is CashSourceRow => !!x) : role.role === 'SHARED' ? role.ledger : role.role === 'KEPT' ? [role.ledger] : [];
        const effect = (bank ? BigInt(bank.signedCents) : 0n) - sum(ledger.map(x => BigInt(x.signedCents)));
        return { ...classify(r, bank, ledger, period, currency, role), status: r.status, effect: signed(effect), bankRecordId: r.bankRecordId, ledgerRecordIds: role ? ledger.map(x => x.recordId) : r.ledgerRecordIds };
    });
    return assembleStatement(snapshot, items);
}

/**
 * The statement for a snapshot and its classified exception items: totals, the unexplained remainder and the three
 * identities. Shared by buildStatement and the reconciliation layer, which reclassifies items it links.
 */
export function assembleStatement(snapshot: FinancePoCReconciliationV1, items: StatementItem[]): ReconciliationStatement {
    const { period, currency } = snapshot.scope;
    const bankRows = new Map(snapshot.rows.bank.map(r => [r.recordId, r])), ledgerRows = new Map(snapshot.rows.ledger.map(r => [r.recordId, r]));
    const bankMovement = cents(snapshot.cashMovement.bank), ledgerMovement = cents(snapshot.cashMovement.ledger), difference = cents(snapshot.cashMovement.signedDifference);
    const on = (side: StatementItem['side']) => items.filter(i => i.side === side);
    const adjustedBank = bankMovement + sum(on('BANK').map(i => cents(i.adjustment))), adjustedLedger = ledgerMovement + sum(on('LEDGER').map(i => cents(i.adjustment)));
    const unexplained = sum(items.filter(i => i.category === 'UNEXPLAINED').map(i => cents(i.effect)));
    // Independent of every classification: matched outcomes carry equal amounts, so the exceptions' effects must add up to the difference.
    const effects = sum(items.map(i => cents(i.effect)));
    const matchedEqual = snapshot.results.filter(r => MATCHED.has(r.status)).every(r => {
        const bank = r.bankRecordId ? bankRows.get(r.bankRecordId) : undefined;
        return bank && BigInt(bank.signedCents) === sum(r.ledgerRecordIds.map(id => BigInt(ledgerRows.get(id)?.signedCents ?? '0')));
    });
    // Every record the matcher left open is on exactly one item: none missing, none listed twice.
    const ids = (r: { bankRecordId: string | null; ledgerRecordIds: string[] }) => [...(r.bankRecordId ? [`B:${r.bankRecordId}`] : []), ...r.ledgerRecordIds.map(id => `L:${id}`)];
    const itemIds = items.flatMap(ids), listed = new Set(itemIds);
    const exceptionIds = new Set(snapshot.results.filter(r => !MATCHED.has(r.status)).flatMap(ids));
    const checks: StatementCheck[] = [
        { id: 'effects', label: 'Exceptions account for the whole difference', passed: matchedEqual && effects === difference, detail: `${items.length} exceptions add up to ${money(effects, currency)}; recorded difference ${money(difference, currency)}` },
        { id: 'listed', label: 'Every exception record appears exactly once', passed: itemIds.length === listed.size && listed.size === exceptionIds.size && [...exceptionIds].every(id => listed.has(id)), detail: `${listed.size} records` },
        { id: 'adjusted', label: 'Adjusted bank − adjusted ledger equals the unexplained remainder', passed: adjustedBank - adjustedLedger === unexplained, detail: `${money(adjustedBank, currency)} − ${money(adjustedLedger, currency)} = ${money(adjustedBank - adjustedLedger, currency)}; unexplained ${money(unexplained, currency)}` },
    ];
    return {
        version: STATEMENT_VERSION, period, currency, basis: 'PERIOD_MOVEMENT',
        bank: { movement: signed(bankMovement), items: on('BANK'), adjusted: signed(adjustedBank) },
        ledger: { movement: signed(ledgerMovement), items: on('LEDGER'), adjusted: signed(adjustedLedger) },
        other: items.filter(i => i.side === 'NONE'),
        unexplained: signed(unexplained), explained: unexplained === 0n && !items.some(i => i.category === 'UNEXPLAINED') && checks.every(c => c.passed), checks,
    };
}
