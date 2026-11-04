/**
 * FinGence reconciliation layer v1: verified bank and cash-ledger records in, a fully resolved reconciliation out.
 *
 * It runs autonomously. There is no review or approval queue. Every exception the deterministic matcher leaves open
 * gets exactly one resolution from a stated rule:
 * - matched late or by amount;
 * - a timing item, cleared by an identified record in a later day or month, or still open;
 * - a correcting entry FinGence prepares for the books;
 * - unexplained, which is the only outcome raised for technical attention.
 *
 * Exact cents throughout. Pure: no I/O, model inference or Node-only APIs, so the browser runner and a backend job run
 * the same rules.
 *
 * Built on, and never changing, the shared matcher (`reconcileCashSources`) and the statement identities
 * (`assembleStatement`). Each calendar month is reconciled by the unchanged matcher. The layer then links exceptions
 * that are one transaction recorded on different days or in different months. A single month with no links gives
 * exactly the Phase 1 statement.
 */
import { formatCents, periodRange, reconcileCashSources, type CashSourceScope } from '../poc-reconciliation/engine';
import type { CashSource, CashSourceRow, FinancePoCReconciliationV1 } from '../poc-reconciliation/contracts';
import { assembleStatement, buildStatement, duplicateChoice, money, signed, type ItemCategory, type ReconciliationStatement, type StatementCheck, type StatementItem } from '../poc-reconciliation/statement';

export const RECONCILIATION_LAYER_VERSION = 'fingence-reconciliation-layer-v1' as const;
/** What the layer accepts: several months and any one currency per business. */
export const RECONCILIATION_SCOPE: CashSourceScope = { months: 'MANY', currencies: 'ANY' };
/** Days after it is booked within which a transaction is expected on the other side; beyond them it is not linked. */
export const CLEARING_DAYS = { receipt: 7, payment: 45, ledgerLate: 7 } as const;
export const CASH_ACCOUNT = 'Cash at bank (1000-BANK)';

export const RESOLUTIONS = ['MATCHED_LATE', 'MATCHED_BY_AMOUNT', 'TIMING_CLEARED', 'TIMING_OPEN', 'ENTRY_PREPARED', 'UNEXPLAINED'] as const;
export type Resolution = typeof RESOLUTIONS[number];
export const RESOLUTION_LABEL: Record<Resolution, string> = {
    MATCHED_LATE: 'Matched (recorded days apart)', MATCHED_BY_AMOUNT: 'Matched by amount and date', TIMING_CLEARED: 'Timing difference, cleared',
    TIMING_OPEN: 'Timing difference, expected next statement', ENTRY_PREPARED: 'Correcting entry prepared', UNEXPLAINED: 'Unexplained, flagged',
};

export type LinkedRecord = { period: string; side: 'BANK' | 'LEDGER'; recordId: string; date: string };
export type ResolvedItem = StatementItem & {
    id: string; period: string; resolution: Resolution;
    /** One plain sentence for a Finance user; no accounting or technical terms. */
    summary: string;
    /** The record on the other side that settles this item, when one does. */
    link: LinkedRecord | null;
    entryIds: string[];
};
export type EntryLine = { account: string; amount: string };
export type CorrectingEntry = {
    id: string; period: string; date: string; category: ItemCategory; description: string;
    debit: EntryLine; credit: EntryLine;
    /** Signed cents the entry adds to the ledger's cash account. */
    cashEffect: string;
    sourceRecordIds: string[]; rule: string;
};
export type PeriodStatus = 'BALANCED' | 'BALANCED_AFTER_ENTRIES' | 'UNEXPLAINED_DIFFERENCE' | 'CHECKS_FAILED';
export type PeriodReconciliation = {
    period: string; status: PeriodStatus;
    /** The unchanged matcher snapshot for this month (Phase 1 contract). */
    snapshot: FinancePoCReconciliationV1;
    /** The statement with linked items reclassified; equal to buildStatement(snapshot) when nothing links. */
    statement: ReconciliationStatement;
    matched: number; items: ResolvedItem[]; entries: CorrectingEntry[]; checks: StatementCheck[];
};
export type ReconciliationResult = {
    version: typeof RECONCILIATION_LAYER_VERSION; origin: 'DETERMINISTIC_RULES';
    scope: { organizationId: string; businessId: string; currency: string; periods: string; months: string[] };
    sources: { bank: { sha256: string; period: string; rows: number }; ledger: { sha256: string; period: string; rows: number } };
    status: PeriodStatus;
    periods: PeriodReconciliation[];
    /** Records in months only one side covers; they are reported, never reconciled against nothing. */
    notReconciled: { side: 'BANK' | 'LEDGER'; period: string; records: number; clearing: number }[];
    /** `resolutions` counts items (a cross-month timing difference is an item in each month); `transactions` and `timing` count transactions. */
    totals: { records: number; matched: number; transactions: number; timing: number; resolutions: Record<Resolution, number>; entries: number; unexplained: string };
    entries: CorrectingEntry[];
    /** Unexplained items: the only outcome surfaced for technical attention. */
    attention: ResolvedItem[];
    checks: StatementCheck[];
    /** Plain-language outcome for a Finance user. */
    summary: string;
    rules: string[];
};

const MONTH = /^\d{4}-\d{2}$/;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
const lastDate = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const cents = (value: string) => BigInt(value.replace('.', ''));
const abs = (c: bigint) => (c < 0n ? -c : c);
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const check = (id: string, label: string, passed: boolean, detail: string): StatementCheck => ({ id, label, passed, detail });
const CHEQUE = /\b(cheques?|chq|checks?|cek)\b/i;

function inPeriod(source: CashSource, period: string): CashSource {
    const rows = source.rows.filter(r => r.date.slice(0, 7) === period), ids = new Set(rows.map(r => r.recordId));
    return { ...source, period, rows, evidence: Object.fromEntries(Object.entries(source.evidence).filter(([, e]) => ids.has(e.recordId))) };
}

/** A record the matcher left open. index −1: a record from a later month only one side covers, usable only as clearing evidence. */
type Open = { period: string; index: number; row: CashSourceRow; side: 'BANK' | 'LEDGER' };

/** One record left open by the matcher on each side, same non-empty reference and signed cents, within the clearing window. */
function linkable(a: Open, b: Open) {
    if (a.side === b.side || !a.row.reference.trim() || a.row.reference !== b.row.reference || a.row.signedCents !== b.row.signedCents) return false;
    const [ledger, bank] = a.side === 'LEDGER' ? [a, b] : [b, a], gap = day(bank.row.date) - day(ledger.row.date);
    if (gap >= 0) return gap <= (BigInt(ledger.row.signedCents) > 0n ? CLEARING_DAYS.receipt : CLEARING_DAYS.payment);
    return -gap <= CLEARING_DAYS.ledgerLate;
}

export function reconcile(bank: CashSource, ledger: CashSource, options: { organizationId: string; scope?: CashSourceScope }): ReconciliationResult {
    const scope = options.scope ?? RECONCILIATION_SCOPE;
    if (bank.kind !== 'bank' || ledger.kind !== 'ledger') throw Error('SOURCE_KIND_MISMATCH');
    if (bank.businessId !== ledger.businessId) throw Error('BUSINESS_MISMATCH');
    if (bank.currency !== ledger.currency) throw Error('CURRENCY_MISMATCH');
    if (scope.currencies === 'MYR' && bank.currency !== 'MYR') throw Error('UNSUPPORTED_CURRENCY_BASIS');
    const monthsOf = (s: CashSource) => [...new Set(s.rows.map(r => r.date.slice(0, 7)))].sort();
    const bankMonths = monthsOf(bank), ledgerMonths = monthsOf(ledger);
    if (scope.months === 'ONE' && (bankMonths.length !== 1 || ledgerMonths.length !== 1)) throw Error('MIXED_SOURCE_SCOPE');
    const months = bankMonths.filter(m => ledgerMonths.includes(m) && MONTH.test(m));
    if (!months.length) throw Error('NO_COMMON_PERIOD');

    // 1. Each month through the unchanged matcher and statement rules.
    const base = months.map(period => {
        const snapshot = reconcileCashSources(options.organizationId, inPeriod(bank, period), inPeriod(ledger, period));
        return { period, snapshot, statement: buildStatement(snapshot) };
    });

    // 2. Link single unmatched records across days and months. Every candidate pair is found before any is used,
    //    and only a pair in which each record has exactly one candidate links, so order cannot create a link.
    const open: Open[] = base.flatMap(({ period, snapshot, statement }) => {
        const bankRows = new Map(snapshot.rows.bank.map(r => [r.recordId, r])), ledgerRows = new Map(snapshot.rows.ledger.map(r => [r.recordId, r]));
        return [...statement.bank.items, ...statement.ledger.items, ...statement.other].flatMap((item, index): Open[] => {
            if (item.status === 'BANK_ONLY' && item.bankRecordId) return [{ period, index, row: bankRows.get(item.bankRecordId)!, side: 'BANK' }];
            if (item.status === 'LEDGER_ONLY' && item.ledgerRecordIds.length === 1) return [{ period, index, row: ledgerRows.get(item.ledgerRecordIds[0])!, side: 'LEDGER' }];
            return [];
        });
    });
    // Records in later months only one side covers can show that an item cleared, e.g. next month's bank statement.
    const last = months.at(-1)!, later = (s: CashSource, side: Open['side']): Open[] => s.rows.filter(r => r.date.slice(0, 7) > last).map(row => ({ period: row.date.slice(0, 7), index: -1, row, side }));
    const evidence = [...later(bank, 'BANK'), ...later(ledger, 'LEDGER')];
    const pool = [...open, ...evidence];
    const candidates = new Map(pool.map(o => [o, pool.filter(other => (o.index >= 0 || other.index >= 0) && linkable(o, other))]));
    const partner = new Map<Open, Open>();
    for (const [o, list] of candidates) if (list.length === 1 && candidates.get(list[0])!.length === 1) partner.set(o, list[0]);

    // An item expected at the bank is overdue only when the bank statements supplied run past its clearing window.
    const coverageEnd = lastDate(bankMonths.at(-1)!);
    const periods: PeriodReconciliation[] = base.map(({ period, snapshot, statement }) => {
        const { currency } = snapshot.scope;
        const bankRows = new Map(snapshot.rows.bank.map(r => [r.recordId, r])), ledgerRows = new Map(snapshot.rows.ledger.map(r => [r.recordId, r]));
        const listed = [...statement.bank.items, ...statement.ledger.items, ...statement.other];
        const entries: CorrectingEntry[] = [];
        const items: ResolvedItem[] = listed.map((item, index) => {
            const self = open.find(o => o.period === period && o.index === index), other = self ? partner.get(self) : undefined;
            const id = `${period}:${[item.bankRecordId, ...item.ledgerRecordIds].filter(Boolean).join('+')}`;
            const resolved = (change: Partial<StatementItem>, resolution: Resolution, summary: string, link: LinkedRecord | null = null, entryIds: string[] = []): ResolvedItem =>
                ({ ...item, ...change, id, period, resolution, summary, link, entryIds });
            const amount = money(abs(cents(item.effect)), currency);
            if (self && other) {
                const link: LinkedRecord = { period: other.period, side: other.side, recordId: other.row.recordId, date: other.row.date };
                const v = BigInt(self.row.signedCents), receipt = v > 0n, word = receipt ? 'money in' : 'payment';
                if (other.period === period) return resolved({ category: 'LATE_MATCH', side: 'NONE', adjustment: '0.00', rule: `Same reference and amount on both sides, recorded ${Math.abs(day(other.row.date) - day(self.row.date))} days apart (beyond the matcher's two-day window, within the clearing window).`, note: null },
                    'MATCHED_LATE', `Found in both the bank statement and your books, recorded on ${longDate(self.side === 'BANK' ? self.row.date : other.row.date)} and ${longDate(self.side === 'BANK' ? other.row.date : self.row.date)}.`, link);
                const selfFirst = other.period > period;
                if (selfFirst && self.side === 'LEDGER') {
                    const category: ItemCategory = receipt ? 'DEPOSIT_IN_TRANSIT' : CHEQUE.test(`${self.row.description} ${self.row.reference}`) ? 'UNPRESENTED_CHEQUE' : 'PAYMENT_IN_TRANSIT';
                    return resolved({ category, side: 'BANK', adjustment: signed(v), rule: `Ledger ${receipt ? 'receipt' : 'payment'} with the same reference and amount on the bank statement of ${other.period} (${other.row.recordId}, ${other.row.date}): added to the bank side for ${period}.`, note: null },
                        'TIMING_CLEARED', receipt ? `${amount} you recorded on ${longDate(self.row.date)} reached the bank on ${longDate(other.row.date)}.` : `A ${word} of ${amount} you recorded on ${longDate(self.row.date)} left the bank on ${longDate(other.row.date)}.`, link);
                }
                if (selfFirst) return resolved({ category: 'LEDGER_POSTED_LATE', side: 'LEDGER', adjustment: signed(v), rule: `Bank record with the same reference and amount booked in the ledger in ${other.period} (${other.row.recordId}, ${other.row.date}): the ledger side for ${period} includes it.`, note: null },
                    'TIMING_CLEARED', `The bank showed ${amount} on ${longDate(self.row.date)}; your books recorded it on ${longDate(other.row.date)}.`, link);
                return resolved({ category: 'CLEARED_PRIOR_PERIOD_ITEM', side: self.side === 'BANK' ? 'LEDGER' : 'BANK', adjustment: signed(v), rule: `Settles ${other.row.recordId} (${other.side === 'LEDGER' ? 'ledger' : 'bank'}, ${other.row.date}), listed in ${other.period}.`, note: null },
                    'TIMING_CLEARED', `Completes ${amount} from ${monthName(other.period)}, which was recorded on the other side on ${longDate(other.row.date)}.`, link);
            }
            switch (item.category) {
                case 'DEPOSIT_IN_TRANSIT': case 'UNPRESENTED_CHEQUE': {
                    const row = ledgerRows.get(item.ledgerRecordIds[0])!, window = item.category === 'DEPOSIT_IN_TRANSIT' ? CLEARING_DAYS.receipt : CLEARING_DAYS.payment;
                    const due = new Date((day(row.date) + window) * 86400000).toISOString().slice(0, 10);
                    if (due <= coverageEnd) return resolved({ category: 'UNEXPLAINED', side: 'NONE', adjustment: '0.00', rule: `${item.rule} Expected on the bank statement by ${due}; the statements to ${coverageEnd} do not show it.` },
                        'UNEXPLAINED', `${amount} recorded on ${longDate(row.date)} should have appeared at the bank by ${longDate(due)} but did not. FinGence has flagged it for your technical team.`);
                    return resolved({}, 'TIMING_OPEN', item.category === 'DEPOSIT_IN_TRANSIT' ? `${amount} you recorded on ${longDate(row.date)} had not reached the bank by the end of ${monthName(period)}. FinGence expects it on the next statement.` : `A cheque of ${amount} you recorded on ${longDate(row.date)} had not been cashed by the end of ${monthName(period)}. FinGence expects it on a coming statement.`);
                }
                case 'REFERENCE_ONLY': return resolved({}, 'MATCHED_BY_AMOUNT', `The same amount, ${money(abs(cents(bankRows.get(item.bankRecordId!)!.signedCents)), currency)}, was recorded on the same day on both sides; only the reference differs.`);
                case 'UNEXPLAINED': return resolved({}, 'UNEXPLAINED', `FinGence could not explain ${amount} here. It has been flagged for your technical team.`);
                default: {
                    const made = correctingEntries(item, period, currency, bankRows, ledgerRows, entries.length);
                    entries.push(...made);
                    const plain: Partial<Record<ItemCategory, string>> = {
                        BANK_CHARGE_NOT_IN_LEDGER: `The bank charged a fee of ${amount} that was not in your books. FinGence prepared the entry to add it.`,
                        RECEIPT_NOT_IN_LEDGER: `${amount} arrived at the bank but was not in your books. FinGence prepared the entry to add it, marked "to be identified".`,
                        PAYMENT_NOT_IN_LEDGER: `${amount} left the bank but was not in your books. FinGence prepared the entry to add it, marked "to be identified".`,
                        LEDGER_AMOUNT_ERROR: `Your books show a different amount from the bank. FinGence prepared a correction of ${amount} to match the bank.`,
                        DUPLICATE_LEDGER_POSTING: `This was recorded more than once in your books. FinGence prepared the entry to remove the extra copy.`,
                    };
                    return resolved({}, 'ENTRY_PREPARED', plain[item.category] ?? `FinGence prepared a correcting entry of ${amount}.`, null, made.map(e => e.id));
                }
            }
        });
        // The statement keeps the Phase 1 item shape; the layer's own fields live on `items`.
        const restated = assembleStatement(snapshot, items.map(statementItem));
        const preparedCash = sum(entries.map(e => cents(e.cashEffect))), preparedItems = sum(items.filter(i => i.resolution === 'ENTRY_PREPARED').map(i => cents(i.adjustment)));
        const checks = [...restated.checks, check('entries', 'Correcting entries carry exactly the ledger corrections', preparedCash === preparedItems && entries.every(e => e.debit.amount === e.credit.amount), `entries ${money(preparedCash, currency)}; corrections ${money(preparedItems, currency)}`)];
        const unexplained = items.some(i => i.resolution === 'UNEXPLAINED');
        const status: PeriodStatus = !checks.every(c => c.passed) ? 'CHECKS_FAILED' : unexplained ? 'UNEXPLAINED_DIFFERENCE' : entries.length ? 'BALANCED_AFTER_ENTRIES' : 'BALANCED';
        const matched = snapshot.counts.MATCH_EXACT + snapshot.counts.MATCH_DATE_SHIFT;
        return { period, status, snapshot, statement: restated, matched, items, entries, checks };
    });

    // 3. Whole-run identities: links are symmetric, every record is accounted for once, totals add up.
    const allItems = periods.flatMap(p => p.items), entries = periods.flatMap(p => p.entries);
    const symmetric = allItems.filter(i => i.link).every(i => {
        if (!months.includes(i.link!.period)) {
            const row = (i.link!.side === 'BANK' ? bank : ledger).rows.find(r => r.recordId === i.link!.recordId);
            // The linked record carries the item's own signed amount: a bank item's effect is +amount, a ledger item's −amount.
            return !!row && i.link!.side !== (i.bankRecordId ? 'BANK' : 'LEDGER') && BigInt(row.signedCents) === (i.bankRecordId ? cents(i.effect) : -cents(i.effect));
        }
        const back = allItems.find(o => o.period === i.link!.period && (i.link!.side === 'BANK' ? o.bankRecordId === i.link!.recordId : o.ledgerRecordIds.includes(i.link!.recordId)));
        return !!back?.link && cents(back.effect) === -cents(i.effect) && [i.bankRecordId, ...i.ledgerRecordIds].includes(back.link.recordId);
    });
    const matchedRecords = periods.flatMap(p => p.snapshot.results.filter(r => r.status === 'MATCH_EXACT' || r.status === 'MATCH_DATE_SHIFT').flatMap(r => [`B:${r.bankRecordId}`, ...r.ledgerRecordIds.map(id => `L:${id}`)]));
    const itemRecords = allItems.flatMap(i => [...(i.bankRecordId ? [`B:${i.bankRecordId}`] : []), ...i.ledgerRecordIds.map(id => `L:${id}`)]);
    const accounted = new Set([...matchedRecords, ...itemRecords]);
    const inScope = [...bank.rows.filter(r => months.includes(r.date.slice(0, 7))).map(r => `B:${r.recordId}`), ...ledger.rows.filter(r => months.includes(r.date.slice(0, 7))).map(r => `L:${r.recordId}`)];
    const notReconciled = [
        ...bankMonths.filter(m => !months.includes(m)).map(period => ({ side: 'BANK' as const, period, records: bank.rows.filter(r => r.date.startsWith(period)).length, clearing: allItems.filter(i => i.link?.side === 'BANK' && i.link.period === period).length })),
        ...ledgerMonths.filter(m => !months.includes(m)).map(period => ({ side: 'LEDGER' as const, period, records: ledger.rows.filter(r => r.date.startsWith(period)).length, clearing: allItems.filter(i => i.link?.side === 'LEDGER' && i.link.period === period).length })),
    ];
    const unexplained = sum(allItems.filter(i => i.resolution === 'UNEXPLAINED').map(i => cents(i.effect)));
    const checks = [
        check('periods', 'Every month passes its own identities', periods.every(p => p.checks.every(c => c.passed)), periods.map(p => `${p.period} ${p.checks.every(c => c.passed) ? 'passed' : 'failed'}`).join('; ')),
        check('links', 'Every link pairs two opposite records of equal amount', symmetric, `${allItems.filter(i => i.link).length} linked items`),
        check('accounted', 'Every record in a reconciled month is matched or resolved exactly once', accounted.size === matchedRecords.length + itemRecords.length && inScope.length === accounted.size && inScope.every(r => accounted.has(r)), `${accounted.size} of ${inScope.length} records`),
        check('resolved', 'Every exception has exactly one resolution', allItems.every(i => RESOLUTIONS.includes(i.resolution)), `${allItems.length} exceptions`),
    ];
    const resolutions = Object.fromEntries(RESOLUTIONS.map(r => [r, allItems.filter(i => i.resolution === r).length])) as Record<Resolution, number>;
    const matched = periods.reduce((n, p) => n + p.matched, 0), attention = allItems.filter(i => i.resolution === 'UNEXPLAINED');
    const status: PeriodStatus = !checks.every(c => c.passed) ? 'CHECKS_FAILED' : attention.length ? 'UNEXPLAINED_DIFFERENCE' : entries.length ? 'BALANCED_AFTER_ENTRIES' : 'BALANCED';
    const currency = bank.currency, span = months.length > 1 ? `${monthName(months[0])} to ${monthName(months.at(-1)!)}` : monthName(months[0]);
    const timing = allItems.filter(i => (i.resolution === 'TIMING_CLEARED' || i.resolution === 'TIMING_OPEN') && i.category !== 'CLEARED_PRIOR_PERIOD_ITEM').length;
    const transactions = matched + allItems.filter(i => i.resolution === 'MATCHED_LATE' && i.bankRecordId).length + resolutions.MATCHED_BY_AMOUNT;
    const done = [`${transactions} transaction${transactions === 1 ? '' : 's'} matched`, timing ? `${timing} timing difference${timing === 1 ? '' : 's'} identified${resolutions.TIMING_OPEN ? ` (${resolutions.TIMING_OPEN === timing ? timing === 1 ? 'it is' : 'all' : resolutions.TIMING_OPEN} expected on the next statement)` : ''}` : '', entries.length ? `${entries.length} correcting entr${entries.length === 1 ? 'y' : 'ies'} prepared for your books` : ''].filter(Boolean);
    const summary = status === 'CHECKS_FAILED' ? `FinGence stopped: its own checks on the ${span} reconciliation did not agree. Your technical team has been alerted; no result is shown as final.`
        : `${span}: ${done.join(', ')}. ${attention.length ? `${money(abs(unexplained), currency)} across ${attention.length} item${attention.length === 1 ? '' : 's'} could not be explained and ${attention.length === 1 ? 'has' : 'have'} been flagged for your technical team.` : entries.length ? 'With these entries your books agree with the bank. Nothing needs your attention.' : 'Your bank and your books agree. Nothing needs your attention.'}`;
    return {
        version: RECONCILIATION_LAYER_VERSION, origin: 'DETERMINISTIC_RULES',
        scope: { organizationId: options.organizationId, businessId: bank.businessId, currency, periods: periodRange(months), months },
        sources: { bank: { sha256: bank.sha256, period: bank.period, rows: bank.rows.length }, ledger: { sha256: ledger.sha256, period: ledger.period, rows: ledger.rows.length } },
        status, periods, notReconciled,
        totals: { records: inScope.length, matched, transactions, timing, resolutions, entries: entries.length, unexplained: formatCents(unexplained) },
        entries, attention, checks, summary,
        rules: [
            'Each calendar month is matched by the unchanged deterministic matcher: a unique reference, currency and signed amount within two days.',
            `An unmatched record is linked to one on the other side with the same reference and amount when each is the other's only candidate: receipts within ${CLEARING_DAYS.receipt} days, payments within ${CLEARING_DAYS.payment} days, and late ledger bookings within ${CLEARING_DAYS.ledgerLate} days.`,
            'An item that should have cleared within its window on the statements supplied, and did not, is unexplained.',
            'Correcting entries are prepared automatically: bank charges, receipts and payments missing from the ledger, ledger amount errors and duplicate postings. Unidentified receipts and payments go to a "to be identified" account. They are prepared for the books, not posted to any accounting system.',
            'Months that only one side covers are reported and not reconciled.',
        ],
    };
}

const statementItem = (i: ResolvedItem): StatementItem => ({
    category: i.category, side: i.side, status: i.status, adjustment: i.adjustment, effect: i.effect, bankRecordId: i.bankRecordId, ledgerRecordIds: i.ledgerRecordIds,
    date: i.date, reference: i.reference, description: i.description, rule: i.rule, note: i.note,
});

function correctingEntries(item: StatementItem, period: string, currency: string, bankRows: Map<string, CashSourceRow>, ledgerRows: Map<string, CashSourceRow>, offset: number): CorrectingEntry[] {
    const make = (n: number, date: string, description: string, cash: bigint, other: string, sourceRecordIds: string[]): CorrectingEntry => {
        const amount = formatCents(abs(cash)), cashLine = { account: CASH_ACCOUNT, amount }, otherLine = { account: other, amount };
        return { id: `CE-${period}-${String(offset + n + 1).padStart(3, '0')}`, period, date, category: item.category, description, debit: cash > 0n ? cashLine : otherLine, credit: cash > 0n ? otherLine : cashLine, cashEffect: formatCents(cash), sourceRecordIds, rule: item.rule };
    };
    const bank = item.bankRecordId ? bankRows.get(item.bankRecordId) : undefined;
    const adjustment = cents(item.adjustment);
    switch (item.category) {
        case 'BANK_CHARGE_NOT_IN_LEDGER': return [make(0, bank!.date, `Bank charge: ${bank!.description}`, adjustment, 'Bank charges', [bank!.recordId])];
        case 'RECEIPT_NOT_IN_LEDGER': return [make(0, bank!.date, `Receipt on the bank statement: ${bank!.description}`, adjustment, 'Receipts to be identified', [bank!.recordId])];
        case 'PAYMENT_NOT_IN_LEDGER': return [make(0, bank!.date, `Payment on the bank statement: ${bank!.description}`, adjustment, 'Payments to be identified', [bank!.recordId])];
        case 'LEDGER_AMOUNT_ERROR': {
            const entry = ledgerRows.get(item.ledgerRecordIds[0])!;
            return [make(0, entry.date, `Correct ${entry.recordId} to the bank amount (${money(abs(BigInt(bank!.signedCents)), currency)})`, adjustment, `Account of ${entry.recordId} (correction)`, [entry.recordId, bank!.recordId])];
        }
        case 'DUPLICATE_LEDGER_POSTING': {
            const { kept, reversed } = duplicateChoice(bank!, item.ledgerRecordIds.map(id => ledgerRows.get(id)!));
            return reversed.map((entry, n) => make(n, entry.date, `Reverse duplicate ${entry.recordId} (kept ${kept.recordId})`, -BigInt(entry.signedCents), `Account of ${entry.recordId} (reversal)`, [entry.recordId, kept.recordId, bank!.recordId]));
        }
        default: return [];
    }
}

/** The result without each month's echoed snapshot and statement, for a context that already carries them. */
export type ReconciliationOutcome = Omit<ReconciliationResult, 'periods'> & { periods: Omit<PeriodReconciliation, 'snapshot' | 'statement'>[] };
export const outcomeOf = ({ periods, ...rest }: ReconciliationResult): ReconciliationOutcome =>
    ({ ...rest, periods: periods.map(p => ({ period: p.period, status: p.status, matched: p.matched, items: p.items, entries: p.entries, checks: p.checks })) });

const csvCell = (v: string) => /^[=+\-@\t\r]/.test(v) ? `"'${v.replaceAll('"', '""')}"` : /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
/** Correcting entries as CSV for import into accounting software; cells that a spreadsheet would run as formulas are neutralised. */
export function entriesCsv(entries: CorrectingEntry[]): string {
    const rows = [['Entry', 'Date', 'Description', 'Debit account', 'Credit account', 'Amount', 'Source records'], ...entries.map(e => [e.id, e.date, e.description, e.debit.account, e.credit.account, e.debit.amount, e.sourceRecordIds.join(' ')])];
    return rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}
