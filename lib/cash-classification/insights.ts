/**
 * Analytics over a cash classification: a direct-method statement of cash flows, period-on-period changes by category,
 * cash-basis ratios and monthly activity series. Pure, integer cents; every figure traces to classified bank records.
 */
import { ACTIVITIES, BANK_CHARGES, DUPLICATE_BANK, INTEREST_RECEIVED, NOT_CLASSIFIED, NOT_IN_BOOKS, type Activity, type CashClassification, type CategoryTotal } from './classify';

const abs = (v: bigint) => v < 0n ? -v : v;
const big = (v: string | undefined) => BigInt(v ?? '0');
/** Integer division rounded half away from zero (the divisor is positive). */
const roundDiv = (n: bigint, d: bigint) => (n < 0n ? -((-n * 2n + d) / (2n * d)) : (n * 2n + d) / (2n * d));
/** A signed change as a one-decimal percent of the earlier figure's size; null without an earlier figure. */
export function changePercent(current: bigint, prior: bigint | null): number | null {
    if (prior === null || prior === 0n) return null;
    return Number(roundDiv((current - prior) * 10000n, abs(prior))) / 100;
}
export type ChangeView = { kind: 'none' } | { kind: 'new' } | { kind: 'same' } | { kind: 'percent'; percent: number; favourable: boolean };
/**
 * How a figure moved against the earlier one. Same sign: the change in size (a payment that grew reads +, unfavourable).
 * Sign reversed (a net outflow became an inflow, or back): the signed change against the earlier size, so a reversal is
 * never hidden. More money in, or less money out, is favourable.
 */
export function describeChange(current: bigint, prior: bigint | null): ChangeView {
    if (prior === null) return { kind: 'none' };
    if (prior === 0n) return current === 0n ? { kind: 'none' } : { kind: 'new' };
    if (current === prior) return { kind: 'same' };
    const reversed = (current < 0n) !== (prior < 0n) && current !== 0n;
    return { kind: 'percent', percent: reversed ? changePercent(current, prior)! : changePercent(abs(current), abs(prior))!, favourable: current > prior };
}
/** A ratio as a one-decimal percent; null when the base is zero. */
export function ratioPercent(part: bigint, whole: bigint): number | null {
    return whole === 0n ? null : Number(roundDiv(abs(part) * 10000n, abs(whole))) / 100;
}

export type StatementLine = { category: string; current: bigint; prior: bigint | null };
export type ActivitySection = { activity: Activity; receipts: StatementLine[]; payments: StatementLine[]; net: { current: bigint; prior: bigint | null } };
/** Categories that FinGence named itself, listed after the books' own. */
const OWN = new Set([BANK_CHARGES, INTEREST_RECEIVED, DUPLICATE_BANK, NOT_IN_BOOKS, NOT_CLASSIFIED]);

/** The direct-method statement: per activity, money received and paid by category, this period against the prior one. */
export function cashFlowStatement(k: CashClassification): ActivitySection[] {
    const prior = new Map((k.prior?.categories ?? []).map(c => [c.category, c]));
    const line = (c: CategoryTotal, side: 'in' | 'out'): StatementLine => {
        const p = prior.get(c.category);
        return { category: c.category, current: big(side === 'in' ? c.inCents : c.outCents), prior: k.prior ? big(side === 'in' ? p?.inCents : p?.outCents) : null };
    };
    const order = (a: StatementLine, b: StatementLine) => (OWN.has(a.category) ? 1 : 0) - (OWN.has(b.category) ? 1 : 0) || (abs(b.current) > abs(a.current) ? 1 : abs(b.current) < abs(a.current) ? -1 : a.category.localeCompare(b.category));
    return ACTIVITIES.map(activity => {
        const cats = k.current.categories.filter(c => c.activity === activity);
        // A prior category absent this period still appears, at zero, so the earlier column adds up.
        const missing = (k.prior?.categories ?? []).filter(p => p.activity === activity && !cats.some(c => c.category === p.category))
            .map(p => ({ ...p, inCents: '0', outCents: '0', netCents: '0', records: 0, byMonth: {} }));
        const all = [...cats, ...missing];
        return {
            activity,
            receipts: all.filter(c => big(c.inCents) > 0n || big(prior.get(c.category)?.inCents) > 0n).map(c => line(c, 'in')).sort(order),
            payments: all.filter(c => big(c.outCents) < 0n || big(prior.get(c.category)?.outCents) < 0n).map(c => line(c, 'out')).sort(order),
            net: { current: big(k.current.activities[activity].netCents), prior: k.prior ? big(k.prior.activities[activity].netCents) : null },
        };
    }).filter(s => s.receipts.length || s.payments.length);
}

export type CategoryChange = { category: string; current: bigint; prior: bigint; change: bigint; percent: number | null };
/** Categories ranked by how much their net cash moved against the prior period (the books' categories only). */
export function biggestChanges(k: CashClassification, limit = 6): CategoryChange[] {
    if (!k.prior) return [];
    const names = new Set([...k.current.categories, ...k.prior.categories].map(c => c.category).filter(c => !OWN.has(c)));
    const net = (list: CategoryTotal[], name: string) => list.filter(c => c.category === name).reduce((t, c) => t + big(c.netCents), 0n);
    return [...names].map(category => { const current = net(k.current.categories, category), prior = net(k.prior!.categories, category); return { category, current, prior, change: current - prior, percent: changePercent(current, prior) }; })
        .filter(c => c.change !== 0n).sort((a, b) => abs(b.change) > abs(a.change) ? 1 : abs(b.change) < abs(a.change) ? -1 : a.category.localeCompare(b.category)).slice(0, limit);
}

/** Category name patterns the cash-basis ratios use; a ratio is shown only when the books use such a category. */
const PAYROLL = /\b(payroll|salar(?:y|ies)|wages?|staff costs?|bonus(?:es)?)\b/i;
const DIRECT = /\b(materials?|ingredients?|inventory|stock|raw|cost of (?:sales|goods)|purchases?|supplies)\b/i;
const FIXED = /\b(rent|rental|lease|loan|payroll|salar(?:y|ies)|wages?|insurance|utilit(?:y|ies))\b/i;

export type Ratio = { id: string; label: string; current: number | null; prior: number | null; unit: '%' | 'x'; detail: string; monthly?: bigint };
type Summary = CashClassification['current'];
const opIn = (s: Summary) => big(s.activities.OPERATING.inCents);
const sumOut = (s: Summary, re: RegExp) => s.categories.filter(c => re.test(c.category)).reduce((t, c) => t + big(c.outCents), 0n);
const sumIn = (s: Summary) => s.categories.filter(c => c.activity === 'OPERATING' && !OWN.has(c.category)).reduce((t, c) => t + big(c.inCents), 0n);

/** Cash-basis ratios over the books' categories, this period and the prior one. Never profit margins: cash only. */
export function cashRatios(k: CashClassification): Ratio[] {
    const s = k.current, p = k.prior, out: Ratio[] = [];
    const margin = (x: Summary) => opIn(x) === 0n ? null : Number(roundDiv(big(x.activities.OPERATING.netCents) * 10000n, opIn(x))) / 100;
    out.push({ id: 'operating-margin', label: 'Operating cash margin', current: margin(s), prior: p ? margin(p) : null, unit: '%', detail: 'Net cash from operating activities as a share of operating receipts.' });
    if (s.categories.some(c => PAYROLL.test(c.category))) out.push({ id: 'payroll', label: 'Payroll to receipts', current: ratioPercent(sumOut(s, PAYROLL), sumIn(s)), prior: p ? ratioPercent(sumOut(p, PAYROLL), sumIn(p)) : null, unit: '%', detail: 'Cash paid to staff for every ringgit received from customers.' });
    if (s.categories.some(c => DIRECT.test(c.category))) out.push({ id: 'direct', label: 'Materials to receipts', current: ratioPercent(sumOut(s, DIRECT), sumIn(s)), prior: p ? ratioPercent(sumOut(p, DIRECT), sumIn(p)) : null, unit: '%', detail: 'Cash paid for materials and supplies against cash received from customers.' });
    const fixed = (x: Summary) => sumOut(x, FIXED), months = (x: Summary) => BigInt(Math.max(1, x.months.length));
    const cover = (x: Summary) => fixed(x) === 0n ? null : Number(roundDiv(sumIn(x) * 100n, abs(fixed(x)))) / 100;
    if (fixed(s) !== 0n) out.push({ id: 'fixed-cover', label: 'Receipts cover regular costs', current: cover(s), prior: p ? cover(p) : null, unit: 'x', detail: 'Customer receipts against regular costs: payroll, rent, loan, insurance and utilities.', monthly: abs(fixed(s)) / months(s) });
    return out;
}

export type Concentration = { customers: number; top: { name: string; share: number | null } | null; topThreeShare: number | null };
/** How much of customer receipts the largest payers account for (the books' operating receipts only). */
export function customerConcentration(k: CashClassification): Concentration {
    const byPayer = new Map<string, bigint>();
    for (const r of k.rows) if (r.basis === 'BOOKS' && r.activity === 'OPERATING' && BigInt(r.signedCents) > 0n) byPayer.set(r.counterparty, (byPayer.get(r.counterparty) ?? 0n) + BigInt(r.signedCents));
    const total = [...byPayer.values()].reduce((t, v) => t + v, 0n), ranked = [...byPayer.entries()].sort((a, b) => b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0]));
    return { customers: ranked.length, top: ranked[0] ? { name: ranked[0][0], share: ratioPercent(ranked[0][1], total) } : null, topThreeShare: ratioPercent(ranked.slice(0, 3).reduce((t, [, v]) => t + v, 0n), total) };
}

export type ActivityMonth = { period: string; receipts: bigint; payments: bigint; net: bigint; priorNet: bigint | null };
/** Operating cash by month, with the same calendar month of the prior period where the history has it. */
export function operatingByMonth(k: CashClassification): ActivityMonth[] {
    const prior = new Map<string, bigint>();
    for (const c of k.prior?.categories ?? []) if (c.activity === 'OPERATING') for (const [m, v] of Object.entries(c.byMonth)) prior.set(m, (prior.get(m) ?? 0n) + BigInt(v));
    return k.current.months.map((period, i) => {
        const rows = k.rows.filter(r => r.period === period && r.activity === 'OPERATING');
        const receipts = rows.reduce((t, r) => t + (BigInt(r.signedCents) > 0n ? BigInt(r.signedCents) : 0n), 0n), payments = rows.reduce((t, r) => t + (BigInt(r.signedCents) < 0n ? BigInt(r.signedCents) : 0n), 0n);
        const earlier = k.prior?.months[i];
        return { period, receipts, payments, net: receipts + payments, priorNet: earlier !== undefined && prior.has(earlier) ? prior.get(earlier)! : null };
    });
}
