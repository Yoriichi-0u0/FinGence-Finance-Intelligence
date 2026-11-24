/**
 * Cash classification v1: every verified bank record gets the category the business's own books give it.
 *
 * - A bank record matched to a ledger entry (directly, recorded days apart, cleared timing or same amount and date)
 *   takes that entry's `CategoryLabel`, exactly as the books state it. Nothing is guessed or learned.
 * - A bank record the books do not show is classified by a stated bank rule (a charge, interest, a repeated payment)
 *   or listed as "Not in your books".
 * - Each category belongs to one cash-flow activity (operating, investing, financing) by a fixed, published keyword
 *   rule; operating is the remainder, as in a direct-method statement of cash flows.
 * - Bank history months are classified by payee: a payee the books record under exactly one category this period
 *   takes that category; any other payee stays "Not classified". The coverage is reported, never hidden.
 *
 * Pure and deterministic: integer cents only, no I/O, no model call. Bank category columns are evaluation labels
 * and are never read; only the ledger's own `CategoryLabel` is.
 */
import type { SourceRow } from '../poc-anomalies/source';
import { fromCents, toCents } from '../poc-anomalies/source';
import type { PeriodReconciliation } from '../reconciliation/reconcile';

export const CLASSIFICATION_VERSION = 'fingence-cash-classification-v1';
export const ACTIVITIES = ['OPERATING', 'INVESTING', 'FINANCING'] as const;
export type Activity = typeof ACTIVITIES[number];
export const ACTIVITY_LABEL: Record<Activity, string> = { OPERATING: 'Operating activities', INVESTING: 'Investing activities', FINANCING: 'Financing activities' };
export type Basis = 'BOOKS' | 'BANK_RULE' | 'NOT_CLASSIFIED';

/** Category names FinGence itself gives records the books do not show. */
export const BANK_CHARGES = 'Bank charges', INTEREST_RECEIVED = 'Interest received', DUPLICATE_BANK = 'Repeated on the bank statement', NOT_IN_BOOKS = 'Not in your books', NOT_CLASSIFIED = 'Not classified';
const INVESTING = /\b(equipment|machine(?:ry|s)?|vehicles?|motor|plant|capex|capital expenditure|fixed assets?|property purchase|renovation|computers?|furniture and fittings)\b/i;
const FINANCING = /\b(loans?|borrowings?|financing|hire purchase|dividends?|share capital|capital injection|director'?s? advance|overdraft repayment)\b/i;
const INTEREST = /\binterest\b/i;
const BANK_RULES = new Set([BANK_CHARGES, INTEREST_RECEIVED, DUPLICATE_BANK]);
/** The published activity rule: investing or financing keywords, otherwise operating (the direct-method remainder). */
export function activityOf(category: string): Activity {
    if (FINANCING.test(category)) return 'FINANCING';
    if (INVESTING.test(category)) return 'INVESTING';
    return 'OPERATING';
}
export const ACTIVITY_RULE = 'A category naming a loan, borrowing, financing, hire purchase, dividend or share capital is financing; one naming equipment, machinery, vehicles, plant or other fixed assets is investing; every other category is operating.';

export type ClassifiedRow = { rowId: string; period: string; date: string; counterparty: string; signedCents: string; category: string; activity: Activity; basis: Basis; ledgerRecordId: string | null };
export type CategoryTotal = { category: string; activity: Activity; basis: Basis; inCents: string; outCents: string; netCents: string; records: number; byMonth: Record<string, string> };
export type PeriodSummary = { months: string[]; categories: CategoryTotal[]; activities: Record<Activity, { inCents: string; outCents: string; netCents: string }>; netCents: string; classifiedShare: string | null; booksShare: string | null };
export type CashClassification = {
    version: typeof CLASSIFICATION_VERSION;
    /** True when the ledger states a category for at least one entry; otherwise every record falls back to bank rules. */
    booksHaveCategories: boolean;
    rows: ClassifiedRow[];
    current: PeriodSummary;
    /** The preceding months of equal length from the verified bank history, classified by payee; null without them. */
    prior: (PeriodSummary & { payeeRule: string }) | null;
    /** "Payee · in" or "Payee · out" → the one category this period gives that payee's money (books or a stated bank rule). */
    payees: Record<string, string>;
    checks: { id: string; label: string; passed: boolean; detail: string }[];
};

const abs = (v: bigint) => v < 0n ? -v : v;
/** Basis points of a share as a two-decimal percent string, rounded half away from zero; null when the base is zero. */
export function sharePercent(part: bigint, whole: bigint): string | null {
    if (whole === 0n) return null;
    const bp = (abs(part) * 10000n * 2n + abs(whole)) / (2n * abs(whole));
    return `${bp / 100n}.${(bp % 100n).toString().padStart(2, '0')}`;
}

/** LedgerEntryID → the books' own category, trimmed; entries without one are absent. */
export function ledgerCategories(raw: Record<string, string>[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const r of raw) {
        const id = r.LedgerEntryID?.trim(), label = (r.CategoryLabel ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (id && label) map.set(id, label);
    }
    return map;
}

/**
 * Bank record → the ledger entries the reconciliation settled it against: a matcher match, a match recorded days apart,
 * a cleared timing item, or an exception naming the bank record and its ledger entries (same amount and date, a repeat
 * the bank shows, a different amount, a duplicate posting). The books record each of these transactions.
 */
export function bankToLedger(periods: Pick<PeriodReconciliation, 'snapshot' | 'items'>[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const p of periods) {
        for (const r of p.snapshot.results) if ((r.status === 'MATCH_EXACT' || r.status === 'MATCH_DATE_SHIFT') && r.bankRecordId && r.ledgerRecordIds.length) map.set(r.bankRecordId, r.ledgerRecordIds);
        for (const i of p.items) {
            if (!i.bankRecordId || map.has(i.bankRecordId)) continue;
            if (i.link?.side === 'LEDGER' && (i.resolution === 'MATCHED_LATE' || i.resolution === 'TIMING_CLEARED')) map.set(i.bankRecordId, [i.link.recordId]);
            else if (i.ledgerRecordIds.length && i.resolution !== 'UNEXPLAINED') map.set(i.bankRecordId, i.ledgerRecordIds);
        }
    }
    return map;
}

/** Bank records the books do not show: the statement category the reconciliation gave each one. */
function bankOnlyCategories(periods: Pick<PeriodReconciliation, 'items'>[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of periods) for (const i of p.items) if (i.bankRecordId && !map.has(i.bankRecordId)) map.set(i.bankRecordId, i.category);
    return map;
}

const STRENGTH: Record<Basis, number> = { BOOKS: 2, BANK_RULE: 1, NOT_CLASSIFIED: 0 };
function summarize(rows: { period: string; signedCents: bigint; category: string; activity: Activity; basis: Basis }[], months: string[]): PeriodSummary {
    const cats = new Map<string, { activity: Activity; basis: Basis; in: bigint; out: bigint; n: number; byMonth: Map<string, bigint> }>();
    const act = Object.fromEntries(ACTIVITIES.map(a => [a, { in: 0n, out: 0n }])) as Record<Activity, { in: bigint; out: bigint }>;
    let net = 0n, total = 0n, classified = 0n, books = 0n;
    for (const r of rows) {
        // One entry per category name: a category the books use and a bank rule also names is one line, its basis the strongest.
        const key = r.category;
        const c = cats.get(key) ?? { activity: r.activity, basis: r.basis, in: 0n, out: 0n, n: 0, byMonth: new Map() };
        if (STRENGTH[r.basis] > STRENGTH[c.basis]) c.basis = r.basis;
        if (r.signedCents >= 0n) { c.in += r.signedCents; act[r.activity].in += r.signedCents; } else { c.out += r.signedCents; act[r.activity].out += r.signedCents; }
        c.n++; c.byMonth.set(r.period, (c.byMonth.get(r.period) ?? 0n) + r.signedCents); cats.set(key, c);
        net += r.signedCents; total += abs(r.signedCents);
        if (r.basis !== 'NOT_CLASSIFIED') classified += abs(r.signedCents);
        if (r.basis === 'BOOKS') books += abs(r.signedCents);
    }
    const categories = [...cats.entries()].map(([key, c]) => ({ category: key, activity: c.activity, basis: c.basis, inCents: c.in.toString(), outCents: c.out.toString(), netCents: (c.in + c.out).toString(), records: c.n, byMonth: Object.fromEntries([...c.byMonth.entries()].sort().map(([m, v]) => [m, v.toString()])) }))
        .sort((a, b) => { const d = abs(BigInt(b.netCents)) - abs(BigInt(a.netCents)); return d > 0n ? 1 : d < 0n ? -1 : a.category.localeCompare(b.category); });
    return {
        months, categories, netCents: net.toString(),
        activities: Object.fromEntries(ACTIVITIES.map(a => [a, { inCents: act[a].in.toString(), outCents: act[a].out.toString(), netCents: (act[a].in + act[a].out).toString() }])) as PeriodSummary['activities'],
        classifiedShare: sharePercent(classified, total), booksShare: sharePercent(books, total),
    };
}

/**
 * Classify the verified bank records of the reconciled months, and the preceding equal-length history months by payee.
 * `historyRows` are the verified history (statement months included); `months` are the statement months.
 */
export function classifyCash(input: { bankRows: SourceRow[]; months: string[]; ledger: Map<string, string>; periods: Pick<PeriodReconciliation, 'period' | 'snapshot' | 'items'>[]; historyRows: SourceRow[] }): CashClassification {
    const links = bankToLedger(input.periods), bankOnly = bankOnlyCategories(input.periods), reconciled = new Set(input.periods.map(p => p.period));
    const rows: ClassifiedRow[] = input.bankRows.map(r => {
        // The books' category, when every ledger entry the bank record was settled against states the same one.
        const ids = links.get(r.rowId) ?? [], labels = new Set(ids.map(id => input.ledger.get(id))), only = labels.size === 1 ? [...labels][0] : undefined;
        const signed = toCents(r.signedAmount), ledgerId = only ? ids[0] : ids[0] ?? null, booked = only;
        const base = { rowId: r.rowId, period: r.period, date: r.date, counterparty: r.counterparty, signedCents: signed.toString(), ledgerRecordId: ledgerId };
        if (booked) return { ...base, category: booked, activity: activityOf(booked), basis: 'BOOKS' as const };
        const statement = bankOnly.get(r.rowId);
        if (statement === 'BANK_CHARGE_NOT_IN_LEDGER') return { ...base, category: BANK_CHARGES, activity: 'OPERATING' as const, basis: 'BANK_RULE' as const };
        if (statement === 'RECEIPT_NOT_IN_LEDGER' && INTEREST.test(r.description)) return { ...base, category: INTEREST_RECEIVED, activity: 'OPERATING' as const, basis: 'BANK_RULE' as const };
        if (statement === 'DUPLICATE_BANK_PAYMENT' || statement === 'DUPLICATE_BANK_RECEIPT') return { ...base, category: DUPLICATE_BANK, activity: 'OPERATING' as const, basis: 'BANK_RULE' as const };
        if (statement === 'PAYMENT_NOT_IN_LEDGER' || statement === 'RECEIPT_NOT_IN_LEDGER') return { ...base, category: NOT_IN_BOOKS, activity: 'OPERATING' as const, basis: 'NOT_CLASSIFIED' as const };
        return { ...base, category: NOT_CLASSIFIED, activity: 'OPERATING' as const, basis: 'NOT_CLASSIFIED' as const };
    });
    const current = summarize(rows.map(r => ({ ...r, signedCents: BigInt(r.signedCents) })), input.months);

    // Payee and direction → category, only where this period's books use exactly one category for that payee and direction.
    const seen = new Map<string, Set<string>>();
    for (const r of rows) if (r.basis === 'BOOKS' || r.category === BANK_CHARGES || r.category === INTEREST_RECEIVED) { const key = payeeKey(r.counterparty, BigInt(r.signedCents)); seen.set(key, (seen.get(key) ?? new Set()).add(r.category)); }
    const payees = Object.fromEntries([...seen.entries()].filter(([, s]) => s.size === 1).map(([p, s]) => [p, [...s][0]]).sort());

    // The preceding months of equal length, when the verified history has every one of them.
    const first = input.months[0], n = input.months.length, historyMonths = [...new Set(input.historyRows.map(r => r.period))].sort();
    const before = historyMonths.filter(m => m < first).slice(-n);
    const consecutive = before.length === n && before.every((m, i) => i === 0 || nextMonth(before[i - 1]) === m) && nextMonth(before.at(-1)!) === first;
    const prior = consecutive ? {
        ...summarize(input.historyRows.filter(r => before.includes(r.period)).map(r => {
            const category = payees[payeeKey(r.counterparty, toCents(r.signedAmount))];
            return { period: r.period, signedCents: toCents(r.signedAmount), category: category ?? NOT_CLASSIFIED, activity: category ? activityOf(category) : 'OPERATING' as Activity, basis: !category ? 'NOT_CLASSIFIED' as const : BANK_RULES.has(category) ? 'BANK_RULE' as const : 'BOOKS' as const };
        }), before),
        payeeRule: 'Each earlier bank record takes the category this period gives the same payee, for money in the same direction (from your books or a stated bank rule); a payee with no single category stays not classified.',
    } : null;

    const bankNet = input.bankRows.reduce((t, r) => t + toCents(r.signedAmount), 0n);
    const actNet = ACTIVITIES.reduce((t, a) => t + BigInt(current.activities[a].netCents), 0n);
    const catNet = current.categories.reduce((t, c) => t + BigInt(c.netCents), 0n);
    const ids = new Set(rows.map(r => r.rowId));
    const checks = [
        { id: 'each-once', label: 'Every verified bank record is classified exactly once', passed: ids.size === rows.length && rows.length === input.bankRows.length, detail: `${rows.length} records, ${ids.size} distinct` },
        { id: 'activities-total', label: 'Operating, investing and financing add up to the bank movement', passed: actNet === bankNet, detail: `${fromCents(actNet)} vs ${fromCents(bankNet)}` },
        { id: 'categories-total', label: 'Categories add up to the bank movement', passed: catNet === bankNet, detail: `${fromCents(catNet)} vs ${fromCents(bankNet)}` },
        { id: 'books-only-linked', label: 'A books category is used only for a record the reconciliation settled against that entry', passed: rows.every(r => r.basis !== 'BOOKS' || (!!r.ledgerRecordId && reconciled.has(r.period) && input.ledger.get(r.ledgerRecordId) === r.category)), detail: `${rows.filter(r => r.basis === 'BOOKS').length} records from the books` },
    ];
    return { version: CLASSIFICATION_VERSION, booksHaveCategories: input.ledger.size > 0, rows, current, prior, payees, checks };
}

/** The payee rule's key: a payee and the direction of the money, so a customer's refund keeps its own category. */
export const payeeKey = (counterparty: string, signed: bigint) => `${counterparty} · ${signed < 0n ? 'out' : 'in'}`;

export function nextMonth(period: string) {
    const [y, m] = period.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
