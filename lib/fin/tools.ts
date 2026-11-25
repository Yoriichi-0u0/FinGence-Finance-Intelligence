/**
 * The assistant's tools: read-only and compute functions over one completed processing context, the same verified records
 * every page shows. Each wraps code FinGence already has; none applies anything. A call is validated with zod, runs
 * without a model or I/O, and returns facts in the grounded Q&A's shape (lib/grounded-qa/facts.ts): typed values,
 * the record IDs behind them, at most MAX_ROWS rows and a `truncated` flag. Facts are numbered F1, F2… across one task,
 * so an answer can only cite a figure with a placeholder such as {F3.net}, which code fills (PR 5's claim checker).
 *
 * Text copied from the documents themselves (descriptions, references, counterparty and category names) is untrusted:
 * UNTRUSTED_FIELDS lists those fields so the prompt can quote them as data, never as instructions.
 */
import { z } from 'zod';
import { catalogue, runQueries, type GroundingIndex } from '../grounded-qa/tools';
import { RECONCILIATION_FILTERS, toolCallSchema, type ToolCall } from '../grounded-qa/contracts';
import { count, money, text, type Fact, type SourceRef, type Value } from '../grounded-qa/facts';
import { toCents } from '../poc-anomalies/source';
import { RULES } from '../poc-anomalies/detector';
import { biggestChanges, cashFlowStatement } from '../cash-classification/insights';
import { processingConfidence } from '../confidence';

export const MAX_ROWS = 20;
/** Fields whose text comes from the documents, not from FinGence: quoted to the model as untrusted data. */
export const UNTRUSTED_FIELDS = new Set(['description', 'reference', 'counterparty', 'name', 'category', 'rationale']);

type Draft = Omit<Fact, 'id' | 'query'>;
/** `total` counts every matching row; `truncated` is set when the wrapped code listed fewer than matched. */
type Ran = { drafts: Draft[]; total: number; truncated?: boolean };
export type ToolResult = { tool: string; ok: true; facts: Fact[]; total: number; truncated: boolean } | { tool: string; ok: false; error: string };

const abs = (v: bigint) => v < 0n ? -v : v;
const percentValue = (percent: string | number | null): Value => percent === null ? text('not available') : { kind: 'PERCENT', tenths: Math.round(Number(percent) * 10) };
const plain = (s: string | null | undefined) => text(s ?? 'none');

// ---- Read: the grounded Q&A tools, re-exposed with the catalogue's own enums checked at run time --------------------
const direction = z.enum(['IN', 'OUT', 'ANY']);
const grounded = (tool: ToolCall['tool']) => (index: GroundingIndex, args: object): Ran => {
    const call = toolCallSchema(catalogue(index)).parse({ tool, ...args });
    const drafts = runQueries(index, [call]).map(f => ({ label: f.label, primary: f.primary, fields: f.fields, sources: f.sources }));
    // The grounded tools list a bounded number of rows (a limit, or eight); their first fact counts every match. Keep that
    // full count, so a bounded list is never mistaken for a complete one.
    const countOf = (field: string) => { const v = drafts[0]?.fields[field]; return v?.kind === 'COUNT' ? v.n : drafts.length - 1; };
    const matching = call.tool === 'transactions' ? countOf('matching') : call.tool === 'reconciliation' ? countOf('selected') : call.tool === 'anomalies' ? countOf('candidates')
        : call.tool === 'counterparties' ? new Set(index.rows.filter(r => call.direction === 'ANY' || (call.direction === 'IN') === (toCents(r.signedAmount) > 0n)).map(r => r.counterparty)).size : null;
    if (matching === null) return { drafts, total: drafts.length };
    const listed = call.tool === 'counterparties' ? drafts.length : drafts.length - 1;
    return { drafts, total: matching + drafts.length - listed, truncated: listed < matching };
};

// ---- Read: reconciliation exceptions, one exception, and the records that might settle it ---------------------------
function exceptions(index: GroundingIndex): Ran {
    const r = index.context.outputs.resolution, currency = index.currency;
    if (!r) return { drafts: [{ label: 'Reconciliation exceptions', primary: 'status', fields: { status: text('No reconciliation in this run.') }, sources: [] }], total: 1 };
    const total = r.attention.reduce((n, i) => n + abs(toCents(i.effect)), 0n);
    return {
        drafts: [
            { label: 'Unexplained reconciliation items', primary: 'items', fields: { items: count(r.attention.length), total: money(total, currency), note: text('Only items no stated rule explained; matched, timing and corrected items are not listed.') }, sources: r.attention.map(i => ({ kind: 'RECONCILIATION', id: i.id })) },
            ...r.attention.map((i, n): Draft => ({
                label: `Unexplained item #${n + 1}`, primary: 'amount',
                fields: { id: text(i.id), period: { kind: 'PERIOD', ym: i.period }, side: text(SIDE_TEXT[sideOf(i)]), amount: money(abs(toCents(i.effect)), currency), date: { kind: 'DATE', iso: i.date }, reference: text(i.reference), description: text(i.description), summary: text(i.summary) },
                sources: itemSources(i),
            })),
        ],
        total: r.attention.length + 1,
    };
}
type Item = NonNullable<GroundingIndex['context']['outputs']['resolution']>['attention'][number];
/** Which side an item has records on, from the records themselves (its `side` field says which movement it adjusts). */
const sideOf = (i: Item): 'BANK' | 'LEDGER' | 'BOTH' => i.bankRecordId && !i.ledgerRecordIds.length ? 'BANK' : !i.bankRecordId && i.ledgerRecordIds.length ? 'LEDGER' : 'BOTH';
const SIDE_TEXT = { BANK: 'On the bank statement only', LEDGER: 'In the books only', BOTH: 'On both sides' } as const;
const itemSources = (i: Item): SourceRef[] => [{ kind: 'RECONCILIATION', id: i.id }, ...(i.bankRecordId ? [{ kind: 'BANK_ROW' as const, id: i.bankRecordId }] : []), ...i.ledgerRecordIds.map(id => ({ kind: 'LEDGER_ROW' as const, id }))];
function allItems(index: GroundingIndex): Item[] { return index.context.outputs.resolution?.periods.flatMap(p => p.items) ?? []; }
function records(index: GroundingIndex) {
    const rec = index.context.outputs.reconciliation;
    return { bank: new Map((rec?.rows.bank ?? []).map(r => [r.recordId, r])), ledger: new Map((rec?.rows.ledger ?? []).map(r => [r.recordId, r])) };
}
type Rec = NonNullable<GroundingIndex['context']['outputs']['reconciliation']>['rows']['bank'][number];
const recordDraft = (label: string, side: 'BANK' | 'LEDGER', r: Rec, currency: string): Draft => ({
    label, primary: 'amount',
    fields: { recordId: text(r.recordId), side: text(side === 'BANK' ? 'Bank statement' : 'Books'), amount: money(abs(BigInt(r.signedCents)), currency), direction: text(BigInt(r.signedCents) < 0n ? 'Money out' : 'Money in'), date: { kind: 'DATE', iso: r.date }, reference: text(r.reference), description: text(r.description) },
    sources: [{ kind: side === 'BANK' ? 'BANK_ROW' : 'LEDGER_ROW', id: r.recordId }],
});
function exceptionDetail(index: GroundingIndex, args: { id: string }): Ran {
    const i = allItems(index).find(x => x.id === args.id), currency = index.currency;
    if (!i) throw new ToolError(`No reconciliation item ${args.id} in this run.`);
    const { bank, ledger } = records(index), o = index.context.outputs;
    const entries = (o.resolution?.entries ?? []).filter(e => i.entryIds.includes(e.id));
    const drafts: Draft[] = [{
        label: `Reconciliation item ${i.id}`, primary: 'amount',
        fields: {
            id: text(i.id), period: { kind: 'PERIOD', ym: i.period }, resolution: text(i.resolution), status: text(i.status), side: text(SIDE_TEXT[sideOf(i)]),
            amount: money(abs(toCents(i.effect)), currency), effectOnDifference: money(toCents(i.effect), currency), date: { kind: 'DATE', iso: i.date },
            reference: text(i.reference), description: text(i.description), rule: text(i.rule), summary: text(i.summary), settledBy: plain(i.link?.recordId),
        },
        sources: itemSources(i),
    }];
    const b = i.bankRecordId ? bank.get(i.bankRecordId) : undefined;
    if (b) drafts.push(recordDraft('The bank record', 'BANK', b, currency));
    for (const id of i.ledgerRecordIds) { const l = ledger.get(id); if (l) drafts.push(recordDraft('A ledger record', 'LEDGER', l, currency)); }
    for (const e of entries) drafts.push({ label: `Correcting entry ${e.id}`, primary: 'cashEffect', fields: { description: text(e.description), debit: text(e.debit.account), credit: text(e.credit.account), cashEffect: money(toCents(e.cashEffect), currency), rule: text(e.rule) }, sources: e.sourceRecordIds.map(id => ({ kind: bank.has(id) ? 'BANK_ROW' as const : 'LEDGER_ROW' as const, id })) });
    return { drafts, total: drafts.length };
}

/**
 * Records on the other side that might settle an exception, ranked by code: a shared reference token, the amount (exact,
 * within 1%, within 5%), then how many days apart. A candidate is only a lead for a person to judge, never a match.
 */
export function rankCandidates(target: { amount: bigint; date: string; reference: string; exclude: Set<string> }, pool: Rec[]) {
    const tokens = (s: string) => new Set(s.toUpperCase().match(/[A-Z0-9]{3,}/g) ?? []);
    const mine = tokens(target.reference), day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    return pool.filter(r => !target.exclude.has(r.recordId)).map(r => {
        const amount = abs(BigInt(r.signedCents)), gap = abs(amount - target.amount);
        const amountScore = gap === 0n ? 3 : gap * 100n <= target.amount ? 2 : gap * 20n <= target.amount ? 1 : 0;
        const shared = [...tokens(r.reference)].filter(t => mine.has(t));
        // A shared reference is strong evidence (worth two points); the amount adds up to three; days apart break ties.
        return { record: r, amountScore, shared, score: amountScore + (shared.length ? 2 : 0), days: Math.abs(Math.round(day(r.date) - day(target.date))) };
    }).filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score || b.shared.length - a.shared.length || a.days - b.days || a.record.recordId.localeCompare(b.record.recordId));
}
function candidateMatches(index: GroundingIndex, args: { id: string; limit: number }): Ran {
    const i = allItems(index).find(x => x.id === args.id), currency = index.currency;
    if (!i) throw new ToolError(`No reconciliation item ${args.id} in this run.`);
    const side = sideOf(i);
    if (side === 'BOTH') return { drafts: [{ label: 'Possible matches', primary: 'status', fields: { status: text('This item already has records on both sides.') }, sources: itemSources(i) }], total: 1 };
    const { bank, ledger } = records(index);
    const pool = [...(side === 'BANK' ? ledger : bank).values()];
    const ranked = rankCandidates({ amount: abs(toCents(i.effect)), date: i.date, reference: i.reference, exclude: new Set([...(i.bankRecordId ? [i.bankRecordId] : []), ...i.ledgerRecordIds]) }, pool);
    const AMOUNT = ['different amount', 'within 5%', 'within 1%', 'same amount'];
    return {
        drafts: ranked.slice(0, args.limit).map((c, n) => {
            const d = recordDraft(`Possible match #${n + 1} for ${i.id} (a lead, not confirmed)`, side === 'BANK' ? 'LEDGER' : 'BANK', c.record, currency);
            return { ...d, fields: { ...d.fields, amountMatch: text(AMOUNT[c.amountScore]), sharedReference: text(c.shared.join(', ') || 'none'), daysApart: count(c.days) } };
        }),
        total: ranked.length,
    };
}

// ---- Read: one anomaly ----------------------------------------------------------------------------------------------
function anomalyDetail(index: GroundingIndex, args: { rowId: string }): Ran {
    const o = index.context.outputs, a = o.anomalies.find(x => x.row.rowId === args.rowId), currency = index.currency;
    if (!a) throw new ToolError(`No anomaly candidate on bank row ${args.rowId} in this run.`);
    const r = o.anomalyResolution?.items.find(x => x.row.rowId === args.rowId);
    const cents = toCents(a.row.signedAmount);
    return {
        drafts: [{
            label: `Anomaly candidate on ${a.row.rowId}`, primary: 'amount',
            fields: {
                id: text(a.row.rowId), amount: money(abs(cents), currency), direction: text(cents < 0n ? 'Money out' : 'Money in'), date: { kind: 'DATE', iso: a.row.date },
                counterparty: text(a.row.counterparty), description: text(a.row.description), reference: text(a.row.reference), severity: text(a.severity),
                rules: text(a.findings.map(f => RULES[f.ruleId].title).join('; ')), rationale: text(a.findings.map(f => f.rationale).join(' ')),
                outcome: text(!r ? 'Not checked against the books' : r.resolution === 'CORROBORATED_BY_BOOKS' ? 'Confirmed by the books' : 'Flagged: the books do not confirm it'),
                bookedAs: plain(r?.booked?.ledgerRecordIds.join(', ')),
            },
            sources: [{ kind: 'ANOMALY', id: a.row.rowId }, { kind: 'BANK_ROW', id: a.row.rowId }, ...(r?.booked?.ledgerRecordIds ?? []).map(id => ({ kind: 'LEDGER_ROW' as const, id }))],
        }],
        total: 1,
    };
}

// ---- Read: categories, the cash flow statement and the biggest changes (from the books' own categories) ------------
function classification(index: GroundingIndex) {
    const k = index.context.outputs.classification;
    if (!k) throw new ToolError('Cash categories are not available for this run (no reconciliation).');
    return k;
}
function categories(index: GroundingIndex, args: { limit: number }): Ran {
    const k = classification(index), currency = index.currency, c = k.current;
    const sorted = [...c.categories].sort((a, b) => Number(abs(BigInt(b.netCents)) - abs(BigInt(a.netCents))) || a.category.localeCompare(b.category));
    return {
        drafts: [
            { label: `Cash by category, ${index.scope.period}`, primary: 'categories', fields: { categories: count(c.categories.length), classifiedShare: percentValue(c.classifiedShare), fromTheBooksShare: percentValue(c.booksShare), note: text('Categories come from the books\' own labels and a few stated bank rules, never from AI.') }, sources: [{ kind: 'TOTALS', id: index.scope.period }] },
            ...sorted.slice(0, args.limit).map((t, n): Draft => ({
                label: `Category #${n + 1} by size`, primary: 'net',
                fields: { category: text(t.category), activity: text(t.activity), basis: text(t.basis === 'BOOKS' ? 'From the books' : t.basis === 'BANK_RULE' ? 'Stated bank rule' : 'Not classified'), moneyIn: money(BigInt(t.inCents), currency), moneyOut: money(BigInt(t.outCents), currency), net: money(BigInt(t.netCents), currency), records: count(t.records) },
                sources: k.rows.filter(r => r.category === t.category).slice(0, 50).map(r => ({ kind: 'BANK_ROW' as const, id: r.rowId })),
            })),
        ],
        total: c.categories.length + 1,
    };
}
function cashFlow(index: GroundingIndex): Ran {
    const k = classification(index), currency = index.currency, drafts: Draft[] = [];
    const prior = (v: bigint | null): Value => v === null ? text('no prior period') : money(v, currency);
    for (const s of cashFlowStatement(k)) {
        drafts.push({ label: `Net cash from ${s.activity.toLowerCase()} activities`, primary: 'current', fields: { activity: text(s.activity), current: money(s.net.current, currency), prior: prior(s.net.prior) }, sources: [{ kind: 'TOTALS', id: index.scope.period }] });
        for (const [kind, lines] of [['Receipts', s.receipts], ['Payments', s.payments]] as const)
            for (const l of lines) drafts.push({ label: `${kind}: ${s.activity.toLowerCase()}`, primary: 'current', fields: { category: text(l.category), current: money(l.current, currency), prior: prior(l.prior) }, sources: [{ kind: 'TOTALS', id: index.scope.period }] });
    }
    return { drafts, total: drafts.length };
}
function changes(index: GroundingIndex, args: { limit: number }): Ran {
    const k = classification(index), currency = index.currency, list = biggestChanges(k, args.limit);
    if (!list.length) return { drafts: [{ label: 'Biggest changes', primary: 'status', fields: { status: text('No earlier period of the same length to compare with.') }, sources: [] }], total: 1 };
    return { drafts: list.map((c, n): Draft => ({ label: `Change #${n + 1} against the earlier period`, primary: 'change', fields: { category: text(c.category), current: money(c.current, currency), prior: money(c.prior, currency), change: money(c.change, currency), percent: percentValue(c.percent) }, sources: [{ kind: 'TOTALS', id: index.scope.period }, { kind: 'HISTORY', id: index.scope.period }] })), total: list.length };
}

// ---- Read: the cash plan and the run's confidence ------------------------------------------------------------------
function cashPlan(index: GroundingIndex): Ran {
    const p = index.context.outputs.cashPlan, currency = index.currency;
    if (!p || p.status !== 'AVAILABLE') return { drafts: [{ label: 'Cash plan', primary: 'status', fields: { status: text(p?.status === 'UNAVAILABLE' ? p.reason : 'No cash plan for this run.') }, sources: [{ kind: 'FORECAST', id: 'unavailable' }] }], total: 1 };
    const m = (s: string | null): Value => s === null ? text('not available') : money(toCents(s), currency);
    const drafts: Draft[] = p.projection.map(x => ({ label: `Planned month ${x.period}`, primary: 'net', fields: { period: { kind: 'PERIOD', ym: x.period }, receipts: m(x.receipts), payments: m(x.payments), net: m(x.net), balance: m(x.balance), low: m(x.low), high: m(x.high) }, sources: [{ kind: 'FORECAST', id: x.period }] }));
    if (p.accuracy) drafts.push({ label: 'How the plan tested on past months (rolling backtest)', primary: 'tests', fields: { tests: count(p.accuracy.tests), receiptsMiss: percentValue(p.accuracy.receiptsWape), paymentsMiss: percentValue(p.accuracy.paymentsWape), averageNetMiss: m(p.accuracy.netMiss), simpleAverageReceiptsMiss: percentValue(p.accuracy.baseline.receiptsWape) }, sources: [{ kind: 'FORECAST', id: 'backtest' }] });
    return { drafts, total: drafts.length };
}
function confidence(index: GroundingIndex): Ran {
    const c = processingConfidence(index.context);
    if (c.status === 'INCOMPLETE') return { drafts: [{ label: 'Processing confidence', primary: 'status', fields: { status: text('Incomplete'), reason: text(c.reason), checksPassed: count(c.checks.passed), checks: count(c.checks.total) }, sources: [{ kind: 'TOTALS', id: index.scope.period }] }], total: 1 };
    return {
        drafts: [{
            label: 'Processing confidence: how much of the bank movement, by value, FinGence read reliably, checked and explained (not a probability of being right)', primary: 'percent',
            fields: { percent: percentValue(c.percent), band: text(c.band === 'HIGH' ? 'High' : c.band === 'CHECK' ? 'Check advised' : 'Low'), counted: money(BigInt(c.countedCents), c.currency), total: money(BigInt(c.totalCents), c.currency), notReadReliably: money(BigInt(c.read.cents), c.currency), notExplained: money(BigInt(c.explained.cents), c.currency), checksPassed: count(c.checks.passed), checks: count(c.checks.total) },
            sources: [{ kind: 'TOTALS', id: index.scope.period }],
        }],
        total: 1,
    };
}

// ---- Compute: the only way a derived number can appear ------------------------------------------------------------
const REF = /^F([1-9]\d*)\.([A-Za-z][A-Za-z0-9]*)$/;
function moneyOf(ledger: Fact[], ref: string): { cents: bigint; currency: string; fact: Fact } {
    const m = REF.exec(ref);
    const fact = m ? ledger.find(f => f.id === `F${m[1]}`) : undefined;
    const v = fact && m ? fact.fields[m[2]] : undefined;
    if (!fact || !v) throw new ToolError(`${ref} is not a fact field from this task.`);
    if (v.kind !== 'MONEY') throw new ToolError(`${ref} is not an amount.`);
    return { cents: BigInt(v.cents), currency: v.currency, fact };
}
/** Tenths of a percent of part / whole, rounded half away from zero; null when the whole is zero. */
export function tenthsOf(part: bigint, whole: bigint): number | null {
    if (whole === 0n) return null;
    const num = part * 1000n, q = num / whole, r = num % whole;
    return Number(abs(r) * 2n >= abs(whole) ? q + ((num < 0n) !== (whole < 0n) ? -1n : 1n) : q);
}
function compute(_index: GroundingIndex, args: { op: 'sum' | 'difference' | 'percent_change' | 'share'; refs: string[] }, ledger: Fact[]): Ran {
    const vals = args.refs.map(r => moneyOf(ledger, r));
    if (new Set(vals.map(v => v.currency)).size > 1) throw new ToolError('Those amounts are in different currencies.');
    const need = args.op === 'sum' ? [2, 12] : [2, 2];
    if (vals.length < need[0] || vals.length > need[1]) throw new ToolError(args.op === 'sum' ? 'sum needs 2 to 12 amounts.' : `${args.op} needs exactly 2 amounts: the first, then the second.`);
    const currency = vals[0].currency, sources = vals.flatMap(v => v.fact.sources);
    const label = `${args.op.replace('_', ' ')} of ${args.refs.join(', ')}`;
    let result: Value;
    if (args.op === 'sum') result = money(vals.reduce((n, v) => n + v.cents, 0n), currency);
    else if (args.op === 'difference') result = money(vals[0].cents - vals[1].cents, currency);
    else if (args.op === 'percent_change') { const t = tenthsOf(vals[0].cents - vals[1].cents, abs(vals[1].cents)); result = t === null ? text('not available: the earlier amount is zero') : { kind: 'PERCENT', tenths: t }; }
    else { const t = tenthsOf(vals[0].cents, vals[1].cents); result = t === null ? text('not available: the whole is zero') : { kind: 'PERCENT', tenths: t }; }
    return { drafts: [{ label, primary: 'result', fields: { result, of: text(args.refs.join(', ')) }, sources }], total: 1 };
}

// ---- The registry --------------------------------------------------------------------------------------------------
export class ToolError extends Error {}
type Tool = { tier: 'READ' | 'COMPUTE'; description: string; args: z.ZodType; run: (index: GroundingIndex, args: never, ledger: Fact[]) => Ran };
const id = z.string().min(1).max(80);
export const FIN_TOOLS = {
    cash_summary: { tier: 'READ', description: 'Money in, money out, net and counts for one month, or for the whole statement period.', args: z.strictObject({ period: z.string().describe('A month as YYYY-MM, or the statement period') }), run: grounded('cash_summary') },
    transactions: { tier: 'READ', description: 'Bank transactions, filtered by direction and counterparty, sorted, with record IDs.', args: z.strictObject({ direction, counterparty: z.string().nullable(), sort: z.enum(['LARGEST', 'EARLIEST', 'LATEST']), limit: z.number().int().min(1).max(8) }), run: grounded('transactions') },
    counterparties: { tier: 'READ', description: 'The largest counterparties by money received, paid or both.', args: z.strictObject({ direction, limit: z.number().int().min(1).max(10) }), run: grounded('counterparties') },
    monthly_history: { tier: 'READ', description: 'Money in, out and net for every month in the verified history.', args: z.strictObject({}), run: grounded('monthly_history') },
    reconciliation: { tier: 'READ', description: 'Bank against books: the difference, matched counts, and items of one status.', args: z.strictObject({ status: z.enum(RECONCILIATION_FILTERS) }), run: grounded('reconciliation') },
    anomalies: { tier: 'READ', description: 'Unusual bank records and whether the books confirmed or flagged each. A candidate is never a finding of fraud.', args: z.strictObject({ severity: z.enum(['ANY', 'HIGH', 'MEDIUM']) }), run: grounded('anomalies') },
    exceptions: { tier: 'READ', description: 'The reconciliation items no stated rule explained, with their IDs.', args: z.strictObject({}), run: exceptions },
    exception_detail: { tier: 'READ', description: 'One reconciliation item with its bank and ledger records and any correcting entry.', args: z.strictObject({ id }), run: exceptionDetail },
    candidate_matches: { tier: 'COMPUTE', description: 'Records on the other side that might settle an item, ranked by code on amount, shared reference and days apart. Leads only, never confirmed matches.', args: z.strictObject({ id, limit: z.number().int().min(1).max(5) }), run: candidateMatches },
    anomaly_detail: { tier: 'READ', description: 'One anomaly candidate: its record, the rules it met, and what the books say.', args: z.strictObject({ rowId: id }), run: anomalyDetail },
    categories: { tier: 'READ', description: 'Cash by category, from the books\' own labels, largest first, with how much was classified.', args: z.strictObject({ limit: z.number().int().min(1).max(MAX_ROWS - 1) }), run: categories },
    cash_flow_statement: { tier: 'READ', description: 'The cash flow statement by activity and category, against the earlier period of the same length.', args: z.strictObject({}), run: cashFlow },
    biggest_changes: { tier: 'READ', description: 'The categories that changed most against the earlier period.', args: z.strictObject({ limit: z.number().int().min(1).max(6) }), run: changes },
    cash_plan: { tier: 'READ', description: 'The six-month cash plan by month, with its tested range and how it scored on past months.', args: z.strictObject({}), run: cashPlan },
    confidence: { tier: 'READ', description: 'How much of the bank movement FinGence read reliably, checked and explained, with what fell short.', args: z.strictObject({}), run: confidence },
    compute: { tier: 'COMPUTE', description: 'Sum, difference, percent change or share of amounts already in this task\'s facts, cited as F3.net. The only way to derive a new figure.', args: z.strictObject({ op: z.enum(['sum', 'difference', 'percent_change', 'share']), refs: z.array(z.string().regex(REF)).min(2).max(12) }), run: compute },
} satisfies Record<string, Tool>;
export type FinToolName = keyof typeof FIN_TOOLS;
export const FIN_TOOL_NAMES = Object.keys(FIN_TOOLS) as FinToolName[];

/**
 * Run one tool call: validate its arguments, run it, and number its facts after the task's earlier ones. Errors come
 * back as a result the model can read and recover from, never as an exception.
 */
export function runFinTool(index: GroundingIndex, call: { name: string; arguments: unknown }, ledger: Fact[]): ToolResult {
    // Only the registry's own entries: never an inherited name such as toString or __proto__.
    const tool = Object.hasOwn(FIN_TOOLS, call.name) ? (FIN_TOOLS as Record<string, Tool>)[call.name] : undefined;
    if (!tool) return { tool: call.name, ok: false, error: `There is no tool called ${call.name}.` };
    const args = tool.args.safeParse(call.arguments);
    if (!args.success) return { tool: call.name, ok: false, error: `The arguments do not fit: ${args.error.issues.map(i => `${i.path.join('.') || 'arguments'} ${i.message}`).join('; ')}`.slice(0, 300) };
    try {
        const { drafts, total, truncated } = tool.run(index, args.data as never, ledger);
        const kept = drafts.slice(0, MAX_ROWS), query = new Set(ledger.map(f => f.query)).size;
        return { tool: call.name, ok: true, facts: kept.map((d, n) => ({ ...d, id: `F${ledger.length + n + 1}`, query })), total, truncated: !!truncated || drafts.length > MAX_ROWS || total > kept.length };
    } catch (error) {
        if (error instanceof ToolError) return { tool: call.name, ok: false, error: error.message };
        if (error instanceof z.ZodError) return { tool: call.name, ok: false, error: 'Those values are not in this run (for example a month or counterparty it does not have).' };
        throw error;
    }
}
