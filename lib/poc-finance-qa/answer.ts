import { groupDigits } from '../poc-anomalies/format';
import { toCents } from '../poc-anomalies/source';
import { RULES, type RuleId, type Severity } from '../poc-anomalies/detector';
import { RECONCILIATION_STATUSES, type ReconciliationStatus, type ReconciliationView } from '../poc-anomalies/reconciliation';
import { MIN_MONTHS, nextPeriod, type BusinessForecast, type Metric, type MetricBacktest } from '../poc-forecast/forecast';
import type { BankTotals } from '../poc-insights/model';
import type { ReconciliationReviewAggregateV1 } from '../poc-reconciliation/reviews';

/**
 * Rule-based financial-facts answers. A fixed keyword router picks one supported intent and every
 * figure is copied from facts the server computed from the selected, authorized uploaded source.
 * Nothing here is a language model; unsupported questions are refused instead of improvised.
 */
export const ANSWER_VERSION = 'poc-finance-answer-v1' as const;
export const ANSWER_ORIGIN = 'DETERMINISTIC_VERIFIED_SOURCE' as const;
export const MAX_QUESTION = 300;
export const INTENTS = {
    SOURCE_TOTALS: 'Source records, credits and debits',
    CASH_MOVEMENT: 'Net signed bank cash movement',
    RECONCILIATION_DIFFERENCE: 'Bank-minus-ledger difference',
    RECONCILIATION_MATCHES: 'Reconciliation matches by category',
    REVIEW_ITEMS: 'Records that require review',
    ANOMALY_COUNT: 'Anomaly review candidates',
    MONTHLY_HISTORY: 'Observed monthly history',
    CASH_FORECAST: 'Next-month cash baseline',
} as const;
export type Intent = keyof typeof INTENTS;
export type RefusalCode = 'UNSUPPORTED_METRIC' | 'ADVICE_OR_ALLEGATION' | 'CAUSE_NOT_ESTABLISHED' | 'SELECTION_MISMATCH' | 'UNSUPPORTED_QUESTION';
export type UnavailableCode = 'ABSENT_PERIOD' | 'RECONCILIATION_UNAVAILABLE' | 'FORECAST_UNAVAILABLE';

export type QaSelection = { sourceId: string; fileName: string; sha256: string; businessId: string; businessName: string; period: string; currency: string };
export type QaCandidate = { rowId: string; severity: Severity; rules: RuleId[]; review: 'OPEN' | 'EXPLAINED' | 'ESCALATED' };
/** Everything an answer may quote, computed server-side for one selection. */
export type QaFacts = {
    selection: QaSelection;
    businesses: string[];
    periods: string[];
    totals: BankTotals;
    series: (BankTotals & { period: string })[];
    candidates: QaCandidate[];
    reconciliation: ReconciliationView;
    reconciliationReviews?: ReconciliationReviewAggregateV1 | null;
    forecast: BusinessForecast;
    pooled: { businesses: number; backtest: Record<Metric, Omit<MetricBacktest, 'points'>> } | null;
};
export type Fact = { id: string; label: string; value: string; unit: 'COUNT' | 'MONEY' | 'PERCENT' | 'PERIOD' | 'TEXT'; currency?: string };
export type Evidence = { label: string; href: string; detail: string };
export type RecordGroup = { label: string; detail: string; recordIds: string[] };
export type QaAnswer = {
    version: typeof ANSWER_VERSION; answerOrigin: typeof ANSWER_ORIGIN; liveModel: false;
    status: 'ANSWERED' | 'UNAVAILABLE' | 'REFUSED'; intent: Intent | null; code: RefusalCode | UnavailableCode | null;
    question: string; selection: QaSelection; headline: string; interpretation: string;
    facts: Fact[]; records: RecordGroup[]; evidence: Evidence[];
};

const money = (currency: string, value: string) => `${currency} ${groupDigits(value)}`;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const normalize = (q: string) => q.toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ');

/** Checked before any intent so that, for example, "net profit" never falls through to net cash movement. */
const UNSUPPORTED = /\b(profit\w*|revenues?|income|earnings|ebitda|margins?|expenses?|ratios?|roi|return on|tax(es)?|valuation|balance sheet|cash flow statement|equity|assets?|liabilit\w*|budget\w*)\b/;
const ADVICE = /\b(fraud\w*|embezzl\w*|launder\w*|theft|steal\w*|stole|crim(e|es|inal)|guilty|should (i|we)|recommend\w*|advi[cs]e\w*|invest\w*|buy|sell|loans?|lend\w*|credit ?score|creditworth\w*)\b/;
const CAUSE = /\b(why|causes?|caused|reasons? for|explain\w*|because)\b/;
/** First match wins; the order puts specific intents ahead of the generic words they contain. */
const ROUTES: [Intent, RegExp][] = [
    ['ANOMALY_COUNT', /\b(anomal\w*|outliers?|unusual|irregular\w*|suspicious)\b/],
    ['REVIEW_ITEMS', /\b(review\w*|exceptions?|unmatched|unreconciled|flagged|follow up|attention)\b/],
    ['RECONCILIATION_DIFFERENCE', /\b(differences?|discrepanc\w*|variance)\b|\bbank\b.*\b(versus|vs|against|minus|compared)\b.*\bledger\b|\bledger\b.*\b(versus|vs|against|compared)\b.*\bbank\b/],
    ['RECONCILIATION_MATCHES', /\b(match\w*|reconcil\w*|paired|ledger)\b/],
    ['CASH_FORECAST', /\b(forecast\w*|predict\w*|projection|projected|next month|outlook)\b/],
    ['MONTHLY_HISTORY', /\b(history|historical|trends?|monthly|months|periods|over time|series)\b/],
    ['CASH_MOVEMENT', /\b(cash|movement|net|inflows?|outflows?)\b/],
    ['SOURCE_TOTALS', /\b(records?|rows?|transactions?|credits?|debits?|count|total|totals)\b/],
];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const CURRENCIES: Record<string, string> = { MYR: 'MYR', RM: 'MYR', USD: 'USD', SGD: 'SGD', EUR: 'EUR', GBP: 'GBP', CNY: 'CNY', JPY: 'JPY', AUD: 'AUD', IDR: 'IDR', THB: 'THB', HKD: 'HKD', INR: 'INR' };

/** Months named in the question, as YYYY-MM or a bare month number. "May" counts only with a year. */
function mentionedPeriods(question: string): { period?: string; month?: number }[] {
    const found: { period?: string; month?: number }[] = [];
    for (const m of question.matchAll(/\b(\d{4})-(0[1-9]|1[0-2])\b/g)) found.push({ period: `${m[1]}-${m[2]}` });
    for (const m of question.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b\.?(?:\s+(\d{4}))?/gi)) {
        const name = m[1].toLowerCase(), month = MONTHS.findIndex(full => full.startsWith(name.slice(0, 3))) + 1;
        if (!m[2] && (name === 'may' || name.length === 3 || name === 'sept')) continue;
        found.push(m[2] ? { period: `${m[2]}-${String(month).padStart(2, '0')}` } : { month });
    }
    return found;
}
const fits = (mention: { period?: string; month?: number }, period: string) => mention.period ? mention.period === period : Number(period.slice(5)) === mention.month;

type WordingRefusal = Exclude<RefusalCode, 'SELECTION_MISMATCH'>;
const REFUSALS: Record<WordingRefusal, [headline: string, interpretation: string]> = {
    UNSUPPORTED_METRIC: ['Not answerable from the uploaded bank source.', 'Profit, revenue, expenses and financial ratios need accounting classifications that a bank statement does not contain, so no figure is produced. Ask about bank cash movement, reconciliation, anomaly candidates, monthly history or the cash baseline instead.'],
    ADVICE_OR_ALLEGATION: ['No advice, fraud or wrongdoing findings.', 'FinGence does not give financial or investment advice and does not decide whether anything is fraud. Anomaly candidates are transparent rule outputs that a person must review.'],
    CAUSE_NOT_ESTABLISHED: ['Causes are not established by the source data.', 'Reconciliation categories and anomaly rules show which records differ or stand out, not why. Open the linked records and ask the people responsible for them.'],
    UNSUPPORTED_QUESTION: ['This question is not supported.', 'Only fixed, source-computed questions are answered: records and totals, cash movement, reconciliation difference and matches, records to review, anomaly candidates, monthly history and the next-month cash baseline. Try a suggested question.'],
};
export type Route = { kind: 'INTENT'; intent: Intent } | { kind: 'REFUSED'; code: WordingRefusal };
/** Pure routing on wording only; scope checks against the selection happen in answerQuestion. */
export function route(question: string): Route {
    const q = normalize(question);
    if (UNSUPPORTED.test(q)) return { kind: 'REFUSED', code: 'UNSUPPORTED_METRIC' };
    if (ADVICE.test(q)) return { kind: 'REFUSED', code: 'ADVICE_OR_ALLEGATION' };
    if (CAUSE.test(q)) return { kind: 'REFUSED', code: 'CAUSE_NOT_ESTABLISHED' };
    const hit = ROUTES.find(([, pattern]) => pattern.test(q));
    return hit ? { kind: 'INTENT', intent: hit[0] } : { kind: 'REFUSED', code: 'UNSUPPORTED_QUESTION' };
}

/** Suggested questions for the selection: a one-month (March-only) source differs from a full-year file. */
export function suggestions(facts: Pick<QaFacts, 'periods' | 'reconciliation'>): string[] {
    const reconciled = facts.reconciliation.status === 'AVAILABLE';
    const common = ['How much cash movement was recorded?', 'How many anomalies were identified?', 'What is the next-month cash-movement forecast?'];
    return facts.periods.length >= MIN_MONTHS
        ? ['How many months of history are observed?', ...common, 'How many source records, credits and debits are there?', 'What is the bank-versus-ledger difference?', 'What is net profit?']
        : [...(reconciled ? ['What is the bank-versus-ledger difference?', 'How many transactions were matched?', 'Which transactions require review?'] : ['How many source records, credits and debits are there?', 'Which transactions require review?']), ...common, 'What is net profit?'];
}

const query = (s: QaSelection) => new URLSearchParams({ source: s.sourceId, business: s.businessId, period: s.period, currency: s.currency }).toString();
const links = (s: QaSelection) => ({
    transactions: { label: 'Source transactions', href: `/transactions?${query(s)}`, detail: `${s.fileName} · SHA-256 ${s.sha256.slice(0, 12)}…` },
    anomalies: { label: 'Anomaly review', href: `/anomalies?${query(s)}`, detail: 'Rule findings for each candidate row' },
    report: { label: 'Management report', href: `/anomalies?${query(s)}#management-report`, detail: 'PDF and JSON with the same figures and source hash' },
    reconciliation: { label: 'Reconciliation', href: '/reconciliation', detail: 'Row-level outcomes for the bank and ledger pair' },
    forecasting: { label: 'Forecasting', href: `/forecasting?${new URLSearchParams({ source: s.sourceId, business: s.businessId, period: s.period, currency: s.currency })}`, detail: 'Monthly history, baseline and backtest tables' },
});
const matched = (status: ReconciliationStatus) => status === 'MATCH_EXACT' || status === 'MATCH_DATE_SHIFT';
const CATEGORY: Record<ReconciliationStatus, string> = { MATCH_EXACT: 'exact', MATCH_DATE_SHIFT: 'date shift', BANK_ONLY: 'bank only', LEDGER_ONLY: 'ledger only', AMOUNT_MISMATCH_REVIEW: 'amount review', AMBIGUOUS_DUPLICATE_LEDGER: 'ambiguous ledger', REFERENCE_MISMATCH_REVIEW: 'reference review' };
const percent = (value: string | null) => value === null ? 'not measurable' : `${value}%`;

/** One answer for one question. Same facts and question always give the same answer. */
export function answerQuestion(facts: QaFacts, rawQuestion: string): QaAnswer {
    const question = rawQuestion.trim().replace(/\s+/g, ' '), s = facts.selection, c = s.currency, link = links(s);
    const base = { version: ANSWER_VERSION, answerOrigin: ANSWER_ORIGIN, liveModel: false as const, question, selection: s, facts: [] as Fact[], records: [] as RecordGroup[], evidence: [] as Evidence[] };
    const refuse = (code: RefusalCode, headline: string, interpretation: string, intent: Intent | null = null): QaAnswer => ({ ...base, status: 'REFUSED', intent, code, headline, interpretation });
    const unavailable = (intent: Intent, code: UnavailableCode, headline: string, interpretation: string, evidence: Evidence[] = []): QaAnswer => ({ ...base, status: 'UNAVAILABLE', intent, code, headline, interpretation, evidence });
    const answered = (intent: Intent, headline: string, interpretation: string, facts: Fact[], evidence: Evidence[], records: RecordGroup[] = []): QaAnswer => ({ ...base, status: 'ANSWERED', intent, code: null, headline, interpretation, facts, evidence, records });

    const routed = route(question);
    if (routed.kind === 'REFUSED') return refuse(routed.code, ...REFUSALS[routed.code]);
    const intent = routed.intent;

    // The question can never widen or change the selection; named scope must equal the selected scope.
    const named = question.toUpperCase().match(/\b[A-Z]{2,5}-[A-Z0-9]{1,8}\b/g)?.filter(id => facts.businesses.includes(id) || /^BUS-/.test(id)) ?? [];
    const otherBusiness = named.find(id => id !== s.businessId);
    if (otherBusiness) return refuse('SELECTION_MISMATCH', `The question names ${otherBusiness}, but ${s.businessId} is selected.`, 'Questions never change the selected source, business, month or currency. Choose the business in the selector, then ask again.', intent);
    const currency = [...question.matchAll(/\b(MYR|RM|USD|SGD|EUR|GBP|CNY|JPY|AUD|IDR|THB|HKD|INR)\b/gi)].map(m => CURRENCIES[m[1].toUpperCase()]).find(code => code !== c);
    if (currency) return refuse('SELECTION_MISMATCH', `The question names ${currency}, but the selected currency is ${c}.`, 'Amounts are never converted between currencies. Choose a source and business that use that currency.', intent);
    // An unavailable forecast is reported as unavailable whatever month the question names.
    const target = intent !== 'CASH_FORECAST' ? s.period : facts.forecast.forecast.status === 'AVAILABLE' ? facts.forecast.forecast.period : null;
    const off = target && mentionedPeriods(question).find(m => !fits(m, target));
    if (off) {
        const label = off.period ?? MONTHS[off.month! - 1].replace(/^./, ch => ch.toUpperCase());
        if (intent === 'CASH_FORECAST') return refuse('SELECTION_MISMATCH', `Only the month after the last observed month can be forecast (${target}).`, `The question names ${label}. The baseline forecasts one month ahead and never further.`, intent);
        if (!facts.periods.some(p => fits(off, p))) return unavailable(intent, 'ABSENT_PERIOD', `No ${s.businessId} ${c} rows for ${label} in this source.`, `The uploaded file has ${plural(facts.periods.length, 'observed month')} for this business and currency (${facts.periods[0]}${facts.periods.length > 1 ? ` to ${facts.periods.at(-1)}` : ''}). Missing months are never filled in.`, [link.transactions]);
        return refuse('SELECTION_MISMATCH', `The question names ${label}, but ${s.period} is selected.`, 'Questions never change the selected month. Choose that month in the selector, then ask again.', intent);
    }

    const t = facts.totals, scope = `${s.businessId} · ${s.period}`;
    if (intent === 'SOURCE_TOTALS') return answered(intent,
        `${plural(t.rows, 'source record')} for ${scope}: ${plural(t.creditRows, 'credit')} totalling ${money(c, t.credits)} and ${plural(t.debitRows, 'debit')} totalling ${money(c, t.debits)}.`,
        `Counts and sums of the uploaded bank rows for the selected business, month and currency. Credits add cash and debits remove it by the source's bank direction; no accounting category is inferred.`,
        [{ id: 'rows', label: 'Source records', value: String(t.rows), unit: 'COUNT' }, { id: 'creditRows', label: 'Credit rows', value: String(t.creditRows), unit: 'COUNT' }, { id: 'debitRows', label: 'Debit rows', value: String(t.debitRows), unit: 'COUNT' },
            { id: 'credits', label: 'Bank credits', value: t.credits, unit: 'MONEY', currency: c }, { id: 'debits', label: 'Bank debits', value: t.debits, unit: 'MONEY', currency: c }],
        [link.transactions]);
    if (intent === 'CASH_MOVEMENT') return answered(intent,
        `Net signed bank cash movement for ${scope} is ${money(c, t.net)}.`,
        `It is the sum of the source's signed amounts: ${money(c, t.credits)} of credits and ${money(c, t.debits)} of debits across ${plural(t.rows, 'row')}. This is bank cash movement, not revenue, profit or a statutory cash flow statement.`,
        [{ id: 'net', label: 'Net signed movement', value: t.net, unit: 'MONEY', currency: c }, { id: 'credits', label: 'Bank credits', value: t.credits, unit: 'MONEY', currency: c }, { id: 'debits', label: 'Bank debits', value: t.debits, unit: 'MONEY', currency: c }, { id: 'rows', label: 'Source records', value: String(t.rows), unit: 'COUNT' }],
        [link.transactions, link.report]);
    if (intent === 'ANOMALY_COUNT' || (intent === 'REVIEW_ITEMS' && facts.reconciliation.status !== 'AVAILABLE')) {
        const all = facts.candidates, open = all.filter(x => x.review === 'OPEN'), high = all.filter(x => x.severity === 'HIGH').length;
        const byRule = (Object.keys(RULES) as RuleId[]).map(r => [r, all.filter(x => x.rules.includes(r)).length] as const).filter(([, n]) => n > 0);
        const ruleFacts: Fact[] = byRule.map(([r, n]) => ({ id: `rule.${r}`, label: RULES[r].title, value: String(n), unit: 'COUNT' }));
        const records = [{ label: 'Open anomaly review candidates', detail: 'Deterministic rule findings; open each row on Anomaly review', recordIds: open.map(x => x.rowId) }].filter(g => g.recordIds.length);
        if (intent === 'REVIEW_ITEMS') return answered(intent,
            `${plural(open.length, 'open anomaly review candidate')} for ${scope}; no reconciliation is available for this source.`,
            `${facts.reconciliation.status === 'UNAVAILABLE' ? facts.reconciliation.reason : ''} The candidates come from transparent rules over this uploaded file and need a person's review; they are not fraud findings.`.trim(),
            [{ id: 'open', label: 'Open candidates', value: String(open.length), unit: 'COUNT' }, { id: 'candidates', label: 'All candidates', value: String(all.length), unit: 'COUNT' }, { id: 'rows', label: 'Source records', value: String(t.rows), unit: 'COUNT' }],
            [link.anomalies, link.reconciliation], records);
        return answered(intent,
            `${all.length} of ${plural(t.rows, 'source record')} for ${scope} ${all.length === 1 ? 'is an anomaly review candidate' : 'are anomaly review candidates'} (${high} high, ${all.length - high} medium severity).`,
            `${byRule.length ? `Rule hits: ${byRule.map(([r, n]) => `${RULES[r].title.toLowerCase()} ${n}`).join(', ')}; one row can hit several rules. ` : ''}The rules compare each row with every ${s.businessId} ${c} row in this file, so another file can give a different count. Candidates need human review and are not fraud findings.`,
            [{ id: 'candidates', label: 'Review candidates', value: String(all.length), unit: 'COUNT' }, { id: 'rows', label: 'Source records (denominator)', value: String(t.rows), unit: 'COUNT' }, { id: 'high', label: 'High severity', value: String(high), unit: 'COUNT' }, { id: 'medium', label: 'Medium severity', value: String(all.length - high), unit: 'COUNT' },
                { id: 'open', label: 'Still open', value: String(open.length), unit: 'COUNT' }, ...ruleFacts],
            [link.anomalies, link.report], records);
    }
    if (intent === 'MONTHLY_HISTORY') {
        const months = facts.series, consecutive = months.every((m, i) => i === 0 || m.period === nextPeriod(months[i - 1].period));
        const sorted = [...months].sort((a, b) => Number(toCents(a.net) - toCents(b.net))), low = sorted[0], high = sorted.at(-1)!;
        return answered(intent,
            `${plural(months.length, `${consecutive && months.length > 1 ? 'consecutive ' : ''}observed month`)} for ${s.businessId} (${c})${months.length > 1 ? `, ${months[0].period} to ${months.at(-1)!.period}` : `: ${months[0].period}`}.`,
            `${months.length > 1 ? `Monthly net movement ranged from ${money(c, low.net)} in ${low.period} to ${money(c, high.net)} in ${high.period}. ` : ''}Months are exactly those present in the uploaded file; ${consecutive ? 'none is missing' : 'gaps are not filled in'} and no month is invented.`,
            [{ id: 'months', label: 'Observed months', value: String(months.length), unit: 'COUNT' }, { id: 'first', label: 'First month', value: months[0].period, unit: 'PERIOD' }, { id: 'last', label: 'Last month', value: months.at(-1)!.period, unit: 'PERIOD' },
                ...(months.length > 1 ? [{ id: 'lowest', label: 'Lowest net month', value: low.period, unit: 'PERIOD' as const }, { id: 'highest', label: 'Highest net month', value: high.period, unit: 'PERIOD' as const }] : []),
                ...months.map(m => ({ id: `net.${m.period}`, label: `Net ${m.period} (${m.rows} rows)`, value: m.net, unit: 'MONEY' as const, currency: c }))],
            [link.forecasting, link.transactions]);
    }
    if (intent === 'CASH_FORECAST') {
        const f = facts.forecast.forecast;
        if (f.status !== 'AVAILABLE') return unavailable(intent, 'FORECAST_UNAVAILABLE', `No forecast for ${s.businessId}: ${f.detail}`,
            'Nothing is extrapolated from a shorter history and no forecast figure is shown. Upload a source with more consecutive months to use the baseline.', [link.forecasting]);
        const fc = facts.forecast.currency ?? c, bt = f.backtest, wape = (m: Metric) => bt[m].methods.find(x => x.method === 'MEAN_6')!.wape;
        const pooledNet = facts.pooled?.backtest.net, pooledMean = pooledNet?.methods.find(x => x.method === 'MEAN_6'), pooledLast = pooledNet?.methods.find(x => x.method === 'LAST_MONTH');
        const pooledNote = facts.pooled && pooledMean && pooledLast && pooledNet!.lowestWape !== 'MEAN_6' ? ` Pooled across ${plural(facts.pooled.businesses, 'business', 'businesses')}, net WAPE is ${percent(pooledMean.wape)}, worse than simply repeating last month (${percent(pooledLast.wape)}).` : '';
        return answered(intent,
            `Six-month baseline for ${s.businessId} in ${f.period}: receipts ${money(fc, f.credits)}, payments ${money(fc, f.debits)}, derived net ${money(fc, f.net)}.`,
            `The mean of ${f.basis.first} to ${f.basis.last}, a deterministic statistical baseline, not AI. In ${plural(f.tests, 'rolling-origin backtest month')} its WAPE was ${percent(wape('credits'))} for receipts, ${percent(wape('debits'))} for payments and ${percent(wape('net'))} for net, so net is experimental and low confidence.${pooledNote}`,
            [{ id: 'period', label: 'Forecast month', value: f.period, unit: 'PERIOD' }, { id: 'basis.first', label: 'Baseline from', value: f.basis.first, unit: 'PERIOD' }, { id: 'basis.last', label: 'Baseline to', value: f.basis.last, unit: 'PERIOD' }, { id: 'tests', label: 'Backtest months', value: String(f.tests), unit: 'COUNT' }, { id: 'receipts', label: 'Receipts (bank credits)', value: f.credits, unit: 'MONEY', currency: fc }, { id: 'payments', label: 'Payments (debit magnitude)', value: f.debits, unit: 'MONEY', currency: fc }, { id: 'net', label: 'Derived net (low confidence)', value: f.net, unit: 'MONEY', currency: fc },
                { id: 'wape.receipts', label: 'Receipts WAPE', value: wape('credits') ?? 'n/a', unit: 'PERCENT' }, { id: 'wape.payments', label: 'Payments WAPE', value: wape('debits') ?? 'n/a', unit: 'PERCENT' }, { id: 'wape.net', label: 'Net WAPE', value: wape('net') ?? 'n/a', unit: 'PERCENT' },
                ...(pooledMean && pooledLast ? [{ id: 'pooled.businesses', label: 'Pooled businesses', value: String(facts.pooled!.businesses), unit: 'COUNT' as const }, { id: 'pooled.net.mean6', label: 'Pooled net WAPE, six-month', value: pooledMean.wape ?? 'n/a', unit: 'PERCENT' as const }, { id: 'pooled.net.last', label: 'Pooled net WAPE, last month', value: pooledLast.wape ?? 'n/a', unit: 'PERCENT' as const }] : [])],
            [link.forecasting]);
    }

    // Remaining intents quote the persisted reconciliation, and only when it is bound to this exact source and scope.
    const r = facts.reconciliation;
    if (r.status !== 'AVAILABLE') return unavailable(intent, 'RECONCILIATION_UNAVAILABLE', `No reconciliation for ${s.fileName} · ${scope}.`,
        `${r.reason} Matching months or totals never establish that two uploads are the same source, so no figure is shown.`, [link.reconciliation]);
    const snap = r.snapshot, cm = snap.cashMovement;
    if (cm.bank !== t.net) return unavailable(intent, 'RECONCILIATION_UNAVAILABLE', `No reconciliation for ${s.fileName} · ${scope}.`,
        'The persisted reconciliation bank movement does not equal this source\'s net movement, so neither figure is quoted.', [link.reconciliation]);
    const counts = RECONCILIATION_STATUSES.map(k => [k, snap.counts[k] ?? 0] as const), categoryFacts: Fact[] = counts.map(([k, n]) => ({ id: `count.${k}`, label: CATEGORY[k].replace(/^./, ch => ch.toUpperCase()), value: String(n), unit: 'COUNT' }));
    const hashFacts: Fact[] = [{ id: 'ledgerSha256', label: 'Ledger source SHA-256', value: snap.sources.ledger.sha256, unit: 'TEXT' }];
    const evidence = [link.reconciliation, link.report], hashes = `bank SHA-256 ${snap.sources.bank.sha256.slice(0, 12)}…, ledger SHA-256 ${snap.sources.ledger.sha256.slice(0, 12)}…`;
    if (intent === 'RECONCILIATION_DIFFERENCE') return answered(intent,
        `Bank minus ledger for ${scope} is ${money(c, cm.signedDifference)} (bank ${money(c, cm.bank)}, ledger ${money(c, cm.ledger)}).`,
        `From the persisted reconciliation of this exact uploaded bank file and its ledger pair (${hashes}). The row categories show which records differ; the cause of the difference is not inferred.`,
        [{ id: 'bank', label: 'Bank movement', value: cm.bank, unit: 'MONEY', currency: c }, { id: 'ledger', label: 'Ledger movement', value: cm.ledger, unit: 'MONEY', currency: c }, { id: 'difference', label: 'Bank − ledger', value: cm.signedDifference, unit: 'MONEY', currency: c }, ...categoryFacts, ...hashFacts],
        evidence);
    const bankRecords = snap.results.filter(x => x.bankRecordId).length, matchedBank = snap.results.filter(x => matched(x.status) && x.bankRecordId).length;
    if (intent === 'RECONCILIATION_MATCHES') return answered(intent,
        `${matchedBank} of ${bankRecords} bank records matched a ledger entry: ${snap.counts.MATCH_EXACT ?? 0} exact and ${snap.counts.MATCH_DATE_SHIFT ?? 0} date shift.`,
        `The other outcomes are ${counts.filter(([k]) => !matched(k)).map(([k, n]) => `${n} ${CATEGORY[k]}`).join(', ')}. Categories come from fixed matching rules over the uploaded bank and ledger files (${hashes}).`,
        [{ id: 'matched', label: 'Matched bank records', value: String(matchedBank), unit: 'COUNT' }, { id: 'bankRecords', label: 'Bank records', value: String(bankRecords), unit: 'COUNT' }, ...categoryFacts, ...hashFacts],
        evidence);
    const exceptions = snap.results.filter(x => !matched(x.status)), open = facts.candidates.filter(x => x.review === 'OPEN');
    const review = facts.reconciliationReviews;
    // Metadata must describe this exact saved source pair and scope, never an equal-total/month substitute.
    const reviewBound = review?.version === 'poc-reconciliation-review-aggregate-v1'
        && (['organizationId', 'businessId', 'period', 'currency'] as const).every(k => review.scope[k] === snap.scope[k])
        && review.sources.bank.sha256 === snap.sources.bank.sha256 && review.sources.ledger.sha256 === snap.sources.ledger.sha256
        && review.eligible === exceptions.length
        && Object.values(review.states).every(n => Number.isSafeInteger(n) && n >= 0)
        && Object.values(review.states).reduce((sum, n) => sum + n, 0) === exceptions.length;
    const humanFacts: Fact[] = reviewBound ? (['OPEN', 'INVESTIGATING', 'EXPLAINED', 'ESCALATED'] as const).map(state =>
        ({ id: `review.${state}`, label: `Human review: ${state.toLowerCase()}`, value: String(review.states[state]), unit: 'COUNT' })) : [];
    const humanNote = reviewBound ? `Current human review decisions: Open ${review.states.OPEN}, Investigating ${review.states.INVESTIGATING}, Explained ${review.states.EXPLAINED}, Escalated ${review.states.ESCALATED}.`
        : 'Human review decisions are unavailable for this exact source pair.';
    const groups: RecordGroup[] = RECONCILIATION_STATUSES.filter(k => !matched(k)).map(k => ({ label: `Reconciliation: ${CATEGORY[k]}`, detail: `${snap.counts[k] ?? 0} outcome${snap.counts[k] === 1 ? '' : 's'}`, recordIds: exceptions.filter(x => x.status === k).flatMap(x => [x.bankRecordId, ...x.ledgerRecordIds].filter((v): v is string => !!v)) })).filter(g => g.recordIds.length);
    if (open.length) groups.push({ label: 'Open anomaly review candidates', detail: 'Deterministic rule findings', recordIds: open.map(x => x.rowId) });
    return answered(intent,
        `${plural(exceptions.length, 'original reconciliation exception')} remain for ${scope}; ${plural(open.length, 'open anomaly review candidate')}.`,
        `These are original reconciliation exceptions, unchanged by annotations. ${humanNote} Explained never means matched or cleared; the discrepancy remains. Anomaly candidates come from separate source rules, so a row can appear in both lists. No cause or wrongdoing is inferred.`,
        [{ id: 'exceptions', label: 'Original reconciliation exceptions (unchanged)', value: String(exceptions.length), unit: 'COUNT' }, { id: 'open', label: 'Open anomaly candidates', value: String(open.length), unit: 'COUNT' }, ...humanFacts, ...categoryFacts.filter(f => !/MATCH_(EXACT|DATE_SHIFT)$/.test(f.id))],
        [link.reconciliation, link.anomalies], groups);
}
