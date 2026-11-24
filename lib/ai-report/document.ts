/**
 * The report document: the figures, statements and notes of the AI report, laid out like a Bursa Malaysia listed
 * company's quarterly or annual report (MFRS 134 interim statements with explanatory notes), on a cash basis.
 * Everything here is computed by code from the verified run; the AI only words the Part B commentary.
 */
import { ACTIVITIES, NOT_IN_BOOKS, summarizeMonths, type Activity, type CashClassification, type PeriodSummary } from '../cash-classification/classify';
import type { ProcessingContext } from '../demo/pipeline';
import { RULES } from '../poc-anomalies/detector';
import { toCents } from '../poc-anomalies/source';

export type ReportKind = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'PERIOD';
export type Column = { label: string; months: string[]; summary: PeriodSummary };
export type ColumnGroup = { label: string; columns: Column[] };
export type StatementLine = { category: string; values: bigint[] };
export type StatementSection = { activity: Activity; receipts: StatementLine[]; payments: StatementLine[]; net: bigint[] };
export type ReportDocument = {
    kind: ReportKind; groups: ColumnGroup[]; columns: Column[];
    statement: StatementSection[]; netIncrease: bigint[]; opening: (bigint | null)[]; closing: (bigint | null)[];
    highlights: { label: string; value: bigint; prior: bigint | null; detail: string }[];
    notes: {
        seasonal: string[]; unusual: { when: string; label: string; amount: bigint; why: string }[];
        investing: StatementLine[]; financing: StatementLine[]; segments: StatementLine[];
        reconciliation: { months: number; explained: number; entries: number; unexplained: bigint; open: number };
    };
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number), i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${new Date(Date.UTC(y, m, 0)).getUTCDate()} ${MONTH_NAMES[m - 1]} ${y}`; };
export const monthName = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };
/** The column heading a listed company prints: the period's end date. */
const ended = (months: string[]) => lastDay(months.at(-1)!);

export function kindOf(months: string[]): ReportKind {
    const s = [...months].sort(), m = Number(s[0]?.split('-')[1]);
    if (s.length === 1) return 'MONTHLY';
    if (s.length === 3 && (m - 1) % 3 === 0 && shiftMonth(s[0], 2) === s[2]) return 'QUARTERLY';
    if (s.length === 12) return 'ANNUAL';
    return 'PERIOD';
}

/** Current period against the corresponding period last year where the history has it, else the preceding period. */
function comparatives(k: CashClassification, history: ProcessingContext['outputs']['history']['rows'], months: string[], heading: (m: string[]) => string): Column[] {
    const now = summarizeMonths(k, history, months)!;
    const lastYear = months.map(m => shiftMonth(m, -12)), preceding = months.map(m => shiftMonth(m, -months.length));
    const ly = summarizeMonths(k, history, lastYear), pre = ly ? null : summarizeMonths(k, history, preceding);
    return [{ label: heading(months), months, summary: now }, ...(ly ? [{ label: heading(lastYear), months: lastYear, summary: ly }] : pre ? [{ label: heading(preceding), months: preceding, summary: pre }] : [])];
}

const sumLines = (cols: Column[], pick: (s: PeriodSummary) => { category: string; value: bigint }[]): StatementLine[] => {
    const names = [...new Set(cols.flatMap(c => pick(c.summary).map(x => x.category)))];
    const lines = names.map(category => ({ category, values: cols.map(c => pick(c.summary).filter(x => x.category === category).reduce((t, x) => t + x.value, 0n)) }));
    const size = (l: StatementLine) => { const v = l.values[0]; return v < 0n ? -v : v; };
    return lines.sort((a, b) => size(b) > size(a) ? 1 : size(b) < size(a) ? -1 : a.category.localeCompare(b.category));
};

/** Null when the run has no usable cash classification. */
export function reportDocument(c: ProcessingContext): ReportDocument | null {
    const k = c.outputs.classification, scope = c.scope;
    if (!scope || !k || !k.checks.every(x => x.passed)) return null;
    const history = c.outputs.history.accepted ? c.outputs.history.rows : [], months = [...scope.months].sort(), kind = kindOf(months);
    const groups: ColumnGroup[] = [];
    if (kind === 'QUARTERLY') {
        groups.push({ label: 'Individual quarter ended', columns: comparatives(k, history, months, ended) });
        const ytd = Array.from({ length: Number(months[2].split('-')[1]) }, (_, i) => `${months[2].slice(0, 4)}-${String(i + 1).padStart(2, '0')}`);
        if (ytd.length > 3 && summarizeMonths(k, history, ytd)) groups.push({ label: 'Cumulative to', columns: comparatives(k, history, ytd, ended) });
    } else groups.push({ label: kind === 'ANNUAL' ? 'Twelve months ended' : kind === 'MONTHLY' ? 'Month ended' : `${months.length} months ended`, columns: comparatives(k, history, months, ended) });
    const columns = groups.flatMap(g => g.columns);

    const statement: StatementSection[] = ACTIVITIES.map(activity => ({
        activity,
        receipts: sumLines(columns, s => s.categories.filter(x => x.activity === activity && BigInt(x.inCents) > 0n).map(x => ({ category: x.category, value: BigInt(x.inCents) }))),
        payments: sumLines(columns, s => s.categories.filter(x => x.activity === activity && BigInt(x.outCents) < 0n).map(x => ({ category: x.category, value: BigInt(x.outCents) }))),
        net: columns.map(col => BigInt(col.summary.activities[activity].netCents)),
    })).filter(s => s.receipts.length || s.payments.length);
    const netIncrease = columns.map(col => BigInt(col.summary.netCents));

    // Opening and closing cash only from month-end balances the history proves (see the cash plan).
    const plan = c.outputs.cashPlan, balances = new Map<string, bigint>();
    if (plan?.status === 'AVAILABLE') for (const h of plan.history) if (h.balance !== null) balances.set(h.period, toCents(h.balance));
    // Only for an unbroken run of months: with a gap, the balances would include movements the column leaves out.
    const unbroken = (m: string[]) => m.every((x, i) => i === 0 || shiftMonth(m[i - 1], 1) === x);
    const closing = columns.map(col => unbroken(col.months) ? balances.get(col.months.at(-1)!) ?? null : null);
    // The opening balance is the month-end before the period; when the history starts with the period, it is the
    // closing balance less the period's net movement (the same identity the statement shows).
    const opening = columns.map((col, i) => closing[i] === null ? null : balances.get(shiftMonth(col.months[0], -1)) ?? closing[i]! - netIncrease[i]);

    const cur = columns[0].summary, was = columns[1]?.summary ?? null, sumIn = (s: PeriodSummary) => ACTIVITIES.reduce((t, a) => t + BigInt(s.activities[a].inCents), 0n), sumOut = (s: PeriodSummary) => ACTIVITIES.reduce((t, a) => t + BigInt(s.activities[a].outCents), 0n);
    const compare = columns[1] ? `against ${columns[1].label}` : 'no comparative available';
    const highlights = [
        { label: 'Cash received', value: sumIn(cur), prior: was ? sumIn(was) : null, detail: compare },
        { label: 'Cash paid', value: sumOut(cur), prior: was ? sumOut(was) : null, detail: compare },
        { label: 'Net cash from operating activities', value: BigInt(cur.activities.OPERATING.netCents), prior: was ? BigInt(was.activities.OPERATING.netCents) : null, detail: compare },
        ...(closing[0] !== null ? [{ label: 'Cash and bank balances', value: closing[0], prior: closing[1] ?? null, detail: `at ${ended(months)}` }] : [{ label: 'Net movement in cash', value: netIncrease[0], prior: netIncrease[1] ?? null, detail: compare }]),
    ];

    // A2: the seasonal pattern over the last twelve verified months, from the bank receipts.
    const all = [...new Set(history.map(r => r.period))].sort().filter(m => m <= months.at(-1)!).slice(-12), seasonal: string[] = [];
    if (all.length >= 6) {
        const receipts = all.map(m => history.filter(r => r.period === m).reduce((t, r) => t + (toCents(r.signedAmount) > 0n ? toCents(r.signedAmount) : 0n), 0n));
        const avg = receipts.reduce((t, v) => t + v, 0n) / BigInt(receipts.length), order = receipts.map((v, i) => ({ v, m: all[i] })).sort((a, b) => b.v > a.v ? 1 : b.v < a.v ? -1 : 0);
        const pct = (v: bigint) => avg === 0n ? 0 : Math.round(Number(((v - avg) * 1000n) / avg)) / 10;
        seasonal.push(`Over the ${all.length} months to ${monthName(all.at(-1)!)}, receipts were highest in ${monthName(order[0].m)} and ${monthName(order[1].m)} (${pct(order[0].v) >= 0 ? '+' : ''}${pct(order[0].v)}% and ${pct(order[1].v) >= 0 ? '+' : ''}${pct(order[1].v)}% against the monthly average) and lowest in ${monthName(order.at(-1)!.m)} (${pct(order.at(-1)!.v)}%).`);
    }

    // A3: items outside the normal run of business in the period. One-off categories from the books (as the cash
    // plan reads them), each bank record the books do not show, and anything still flagged after checking the books.
    const unusual: ReportDocument['notes']['unusual'] = [], flagged = new Map((c.outputs.anomalyResolution?.items ?? []).filter(a => a.resolution === 'FLAGGED').map(a => [a.row.rowId, a]));
    if (plan?.status === 'AVAILABLE') for (const o of plan.oneOffs.filter(x => x.category !== NOT_IN_BOOKS)) for (const m of o.months.filter(x => months.includes(x))) {
        const amount = k.rows.filter(r => r.period === m && r.category === o.category && (BigInt(r.signedCents) < 0n) === (o.direction === 'OUT')).reduce((t, r) => t + BigInt(r.signedCents), 0n);
        if (amount !== 0n) unusual.push({ when: monthName(m), label: o.category, amount, why: 'Not a recurring item: seen once or twice in the verified history.' });
    }
    const rule = (id: string) => flagged.get(id)!.findings.map(f => RULES[f.ruleId].title.toLowerCase()).join('; ');
    for (const r of k.rows) if (r.category === NOT_IN_BOOKS && months.includes(r.period)) unusual.push({ when: r.date, label: r.counterparty, amount: BigInt(r.signedCents), why: flagged.has(r.rowId) ? `Not recorded in the books and still flagged: ${rule(r.rowId)}.` : 'Not recorded in the books; a correcting entry has been prepared.' });
    for (const [id, a] of flagged) if (!unusual.some(u => u.label === a.row.counterparty && u.when === a.row.date)) unusual.push({ when: a.row.date, label: a.row.counterparty, amount: toCents(a.row.signedAmount), why: `Still flagged after checking the books: ${rule(id)}.` });

    const periods = c.outputs.resolution?.periods ?? [];
    return {
        kind, groups, columns, statement, netIncrease, opening, closing, highlights,
        notes: {
            seasonal, unusual,
            investing: statement.find(s => s.activity === 'INVESTING')?.payments ?? [], financing: statement.filter(s => s.activity === 'FINANCING').flatMap(s => [...s.receipts, ...s.payments]),
            segments: statement.find(s => s.activity === 'OPERATING')?.receipts ?? [],
            reconciliation: { months: periods.length, explained: periods.filter(p => p.status === 'BALANCED' || p.status === 'BALANCED_AFTER_ENTRIES').length, entries: c.outputs.resolution?.totals.entries ?? 0, unexplained: toCents(c.outputs.resolution?.totals.unexplained ?? '0.00'), open: c.outputs.resolution?.totals.resolutions.TIMING_OPEN ?? 0 },
        },
    };
}
