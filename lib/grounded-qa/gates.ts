/**
 * Deterministic gates for grounded Finance Q&A. The model's plan and answer are untrusted: a plan is
 * accepted only when it parses against the catalogue-bound schema; an answer only when every figure is a
 * placeholder that resolves to a verified fact, its free text carries no figure of its own, every entity it
 * names is cited, and it draws no conclusion the cash records cannot support. Anything else is withheld.
 */
import { ADVICE, UNSUPPORTED } from '../poc-finance-qa/answer';
import { answerSchema, planSchema, type Answer, type Catalogue, type Refusal, type ToolCall } from './contracts';
import { formatValue, type Fact, type SourceRef, type Value } from './facts';

export type GateCheck = { id: string; label: string; passed: boolean; detail: string };
const ALLEGATION = /\b(fraud\w*|embezzl\w*|launder\w*|theft|steal\w*|stole|crim(e|es|inal)|guilty)\b/;
/**
 * Roles, entity types and payment categories the records do NOT contain: counterparties are named, never classified
 * (not even as companies: one payee is payroll), and payments are not categorised. "The largest payee" is verified;
 * "the largest supplier" or "the outside company paid the most" is not, even when the citation is correct.
 * Live finding (M08, gpt-oss-120b): "Which outside company received the most money?" was answered with Staff Payroll.
 */
export const CLASSIFICATION = /\b(outside compan(y|ies)|compan(y|ies)|firms?|organi[sz]ations?|external|third[- ]part(y|ies)|suppliers?|suppl(y|ies|ied) us|vendors?|contractors?|customers?|clients?|employees?|landlords?|tenants?|creditors?|debtors?|shareholders?|directors?|ingredients?|utilit(y|ies)|rents?|rental|salar(y|ies)|wages?|marketing|insurance|inventory|sales|turnover)\b/i;

/** Catalogue counterparties a text names, by full name or by its distinctive first word (e.g. "Borneo", "GrabFood"). */
export function namedCounterparties(text: string, counterparties: string[]): string[] {
    const t = text.toLowerCase(), first = (n: string) => n.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '');
    return counterparties.filter(n => t.includes(n.toLowerCase()) || (first(n).length > 3 && new RegExp(`\\b${first(n)}\\b`).test(t)));
}
/** The text with every named counterparty removed, so a name like "POS Sales Settlement" is never read as a claim. */
function withoutNames(text: string, counterparties: string[]) {
    return [...counterparties].sort((a, b) => b.length - a.length).reduce((t, n) => t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '), text);
}

/**
 * Refused before any model call:
 * - advice and allegations (the rule-based answerer's own pattern);
 * - measures cash records cannot establish (its UNSUPPORTED pattern, plus sales and turnover);
 * - classifications the records do not contain, unless the question itself names the counterparty
 *   ("How much did we pay our supplier Borneo Fresh Supplies?" is answerable; "Which supplier…" is not).
 */
export function preCheck(question: string, counterparties: string[] = []): Refusal | null {
    const q = question.toLowerCase().replace(/[-_/]/g, ' ');
    if (ADVICE.test(q)) return ALLEGATION.test(q) ? 'ALLEGATION' : 'ADVICE';
    const rest = withoutNames(q, counterparties);
    if (UNSUPPORTED.test(rest) || /\b(sales|turnover)\b/.test(rest)) return 'UNSUPPORTED_MEASURE';
    if (CLASSIFICATION.test(rest) && !namedCounterparties(q, counterparties).length) return 'CLASSIFICATION_NOT_RECORDED';
    return null;
}

export type PlanVerdict = { kind: 'QUERIES'; queries: ToolCall[]; checks: GateCheck[] } | { kind: 'REFUSED'; reason: Refusal; checks: GateCheck[] } | { kind: 'INVALID'; checks: GateCheck[] };
export function verifyPlan(raw: unknown, cat: Catalogue): PlanVerdict {
    const parsed = planSchema(cat).safeParse(raw);
    const checks: GateCheck[] = [{ id: 'plan-schema', label: 'Plan uses only catalogue tools and values', passed: parsed.success, detail: parsed.success ? 'Valid' : parsed.error.issues.slice(0, 2).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }];
    if (!parsed.success) return { kind: 'INVALID', checks };
    const { plan } = parsed.data;
    if (plan.kind === 'REFUSE') return { kind: 'REFUSED', reason: plan.reason, checks };
    const unique = [...new Map(plan.queries.map(q => [JSON.stringify(q), q])).values()];
    return { kind: 'QUERIES', queries: unique, checks };
}

export type Segment = { text: string } | { value: string; ref: string; label: string; sources: SourceRef[] };
export type DerivedFact = { id: string; label: string; value: Value; from: string[] };
export type AnswerVerdict = {
    decision: 'ACCEPTED' | 'WITHHELD' | 'INSUFFICIENT';
    checks: GateCheck[]; sentences: Segment[][] | null; cited: string[]; derived: DerivedFact[]; missing: string | null;
};

const PLACEHOLDER = /\{(F\d{1,2}|D[1-4])(?:\.([A-Za-z]{1,24}))?\}/g;
/** Count words. "one"/"once" included: "There was one payment" is a count claim; only the idioms "one of" and "no one" are not. */
const NUMBER_WORDS = /\b(zero|one|once|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|twice|double|triple|percent|per cent)\b/i;
const COUNT_IDIOMS = /\b(one of)\b/gi;
/** Exclusivity claims ("no one other than X was paid") assert something about every other counterparty; no fact establishes that. */
const EXCLUSIVITY = /\b(no one|nobody|none other|no other)\b/i;
/** Clause boundaries: a rank word describes the entity in its own clause ("X was second, ahead of Y" ranks X, not Y). */
const CLAUSE = /[,;:]|\b(?:and|but|while|whereas|ahead of|behind|followed by|than)\b/i;
/** Rank words; each must match a cited fact's own rank label ("Counterparty #2", "Earliest #1"). */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const MONTH_WORDS = /\b(january|february|march|april|june|july|august|september|october|november|december|januari|februari|mac|mei|jun|julai|ogos|oktober|disember)\b/i;
const MONTH_NAMES = [['january', 'januari'], ['february', 'februari'], ['march', 'mac'], ['april'], ['may', 'mei'], ['june', 'jun'], ['july', 'julai'], ['august', 'ogos'], ['september'], ['october', 'oktober'], ['november'], ['december', 'disember']];
/** Accounting conclusions, causes, advice and allegations the cash records cannot support. */
const CONCLUSIONS = /\b(profit\w*|loss[- ]making|revenues?|income|earnings|margins?|ebitda|expenses?|tax(es|ation)?|vat|gst|sst|solven\w*|insolven\w*|bankrupt\w*|liquidity|healthy|unhealthy|fraud\w*|embezzl\w*|launder\w*|theft|stole|steal\w*|illegal|crim(e|es|inal)|guilty|errors?|mistakes?|intentional\w*|deliberate\w*|because|caused|causes?|due to|likely|probably|perhaps|presumably|possibly|should|recommend\w*|advi[cs]e\w*|must|ought|invest\w*)\b/i;
const VOCABULARY = new Set(['MYR', 'RM', 'I', 'AI', 'The', 'This', 'These', 'There', 'It', 'In', 'Of', 'On', 'At', 'For', 'From', 'To', 'And', 'With', 'Bank', 'Ledger', 'Money', 'Net', 'Total', 'No', 'None', 'Your', 'All', 'Each', 'A', 'An', 'By', 'As', 'Over']);

function fieldOf(f: Fact, field: string | null | undefined) { return f.fields[field ?? f.primary]; }
function derive(d: NonNullable<Extract<Answer['answer'], { kind: 'ANSWERED' }>['derived']>[number], facts: Map<string, Fact>): DerivedFact | string {
    const a = fieldOf(facts.get(d.a)!, d.aField), b = fieldOf(facts.get(d.b)!, d.bField);
    if (!a || !b) return `${d.id}: unknown field`;
    const amount = (v: Value) => v.kind === 'MONEY' ? BigInt(v.cents) : v.kind === 'COUNT' ? BigInt(v.n) : null;
    const x = amount(a), y = amount(b);
    if (x === null || y === null || a.kind !== b.kind) return `${d.id}: ${d.op} needs two amounts or two counts`;
    if (a.kind === 'MONEY' && b.kind === 'MONEY' && a.currency !== b.currency) return `${d.id}: different currencies`;
    const label = `${d.op === 'DIFFERENCE' ? 'Difference' : d.op === 'SUM' ? 'Sum' : 'Share'} of ${d.a}${d.aField ? '.' + d.aField : ''} and ${d.b}${d.bField ? '.' + d.bField : ''} (computed by FinGence)`;
    if (d.op === 'SHARE_PERCENT') {
        if (y === 0n || x < 0n || y < 0n || x > y) return `${d.id}: a share needs 0 ≤ part ≤ whole and a non-zero whole`;
        return { id: d.id, label, value: { kind: 'PERCENT', tenths: Number((x * 2000n / y + 1n) / 2n) }, from: [d.a, d.b] };
    }
    const v = d.op === 'DIFFERENCE' ? x - y : x + y;
    return { id: d.id, label, value: a.kind === 'MONEY' ? { kind: 'MONEY', cents: v.toString(), currency: a.currency } : { kind: 'COUNT', n: Number(v) }, from: [d.a, d.b] };
}

export function verifyAnswer(raw: unknown, facts: Fact[], ctx: { question: string; catalogue: Catalogue }): AnswerVerdict {
    const checks: GateCheck[] = [], result = (decision: AnswerVerdict['decision'], extra: Partial<AnswerVerdict> = {}): AnswerVerdict => ({ decision, checks, sentences: null, cited: [], derived: [], missing: null, ...extra });
    const gate = (id: string, label: string, problems: string[]) => { checks.push({ id, label, passed: !problems.length, detail: problems.length ? problems.slice(0, 3).join('; ') : 'Passed' }); return !problems.length; };
    const parsed = answerSchema(facts.map(f => f.id)).safeParse(raw);
    if (!gate('answer-schema', 'Answer matches the strict grounded-answer schema', parsed.success ? [] : parsed.error.issues.slice(0, 2).map(i => `${i.path.join('.')}: ${i.message}`))) return result('WITHHELD');
    const answer = parsed.data!.answer;
    if (answer.kind === 'INSUFFICIENT') return result('INSUFFICIENT', { missing: answer.missing });
    const byId = new Map(facts.map(f => [f.id, f]));

    // 1. Derivations are computed here, never by the model.
    const derived: DerivedFact[] = [], derivationProblems: string[] = [];
    for (const d of answer.derived) { const r = derive(d, byId); if (typeof r === 'string') derivationProblems.push(r); else derived.push(r); }
    if (new Set(answer.derived.map(d => d.id)).size !== answer.derived.length) derivationProblems.push('a derivation ID is used twice');
    if (!gate('derived', 'Derived figures are computed from two verified facts', derivationProblems)) return result('WITHHELD');
    const derivedById = new Map(derived.map(d => [d.id, d]));

    // 2. Every placeholder resolves and is cited by its sentence; no stray braces remain.
    const resolution: string[] = [];
    for (const [i, s] of answer.sentences.entries()) {
        for (const m of s.text.matchAll(PLACEHOLDER)) {
            const [, id, field] = m, f = byId.get(id), d = derivedById.get(id);
            if (!f && !d) resolution.push(`sentence ${i + 1}: {${id}} is not a fact of this answer`);
            else if (f && field && !f.fields[field]) resolution.push(`sentence ${i + 1}: {${id}.${field}} has no such field`);
            else if (d && field) resolution.push(`sentence ${i + 1}: derived {${id}} has no fields`);
            if (!s.cites.includes(id as never)) resolution.push(`sentence ${i + 1}: {${id}} is not in its citations`);
        }
        if (/[{}]/.test(s.text.replace(PLACEHOLDER, ''))) resolution.push(`sentence ${i + 1}: malformed placeholder`);
        for (const c of s.cites) if (!byId.has(c) && !derivedById.has(c)) resolution.push(`sentence ${i + 1}: cites undefined ${c}`);
    }
    if (!gate('placeholders', 'Every figure is a placeholder for a cited, verified fact', resolution)) return result('WITHHELD');

    // 3. The free text carries no figure, date, percentage or record identifier of its own. A bare month name is
    // allowed only when it is the processing period's month or the month of a cited period/date fact (no year: digits stay banned).
    const free = answer.sentences.map(s => s.text.replace(PLACEHOLDER, ' '));
    const citedIds = new Set(answer.sentences.flatMap(s => s.cites).flatMap(c => derivedById.get(c)?.from ?? [c]));
    const verifiedMonths = new Set([+ctx.catalogue.scope.period.slice(5, 7), ...[...citedIds].flatMap(id => Object.values(byId.get(id)?.fields ?? {}).flatMap(v => v.kind === 'PERIOD' ? [+v.ym.slice(5, 7)] : v.kind === 'DATE' ? [+v.iso.slice(5, 7)] : []))]);
    const allowedMonth = new RegExp(`\\b(${[...verifiedMonths].flatMap(m => MONTH_NAMES[m - 1]).join('|')})\\b`, 'gi');
    const unverifiedMonth = (t: string) => { const rest = t.replace(allowedMonth, ' '); return MONTH_WORDS.test(rest) || /\bMay\b/.test(rest); };
    const figures = free.flatMap((t, i) => { const counted = t.replace(COUNT_IDIOMS, ' '); return [/\d/.test(t) ? `sentence ${i + 1}: digits outside placeholders` : '', NUMBER_WORDS.test(counted) ? `sentence ${i + 1}: number word "${counted.match(NUMBER_WORDS)![0]}"` : '', EXCLUSIVITY.test(t) ? `sentence ${i + 1}: an exclusivity claim ("${t.match(EXCLUSIVITY)![0]}") no fact establishes` : '', unverifiedMonth(t) ? `sentence ${i + 1}: a month name that is not a verified period of this answer` : '', /%/.test(t) ? `sentence ${i + 1}: percentage outside a placeholder` : ''].filter(Boolean); });
    if (!gate('no-free-figures', 'No amount, count, date, percentage or identifier typed by the model', figures)) return result('WITHHELD');
    // 3b. A rank word ("second-largest", "the third") must be the rank of the entity it describes: the ranked facts
    // placed in its own clause must have exactly the ranks the clause states. A rank clause with no entity of its own is
    // an appositive: of the entity just before it only when the phrase is set off by commas after that entity
    // ("{F2.name}, the second-largest payee, …"); otherwise, across a conjunction or any other boundary, of the entity
    // just after it ("… and the second-largest payee, {F2.name}, …"). That entity must match exactly. Citing some other fact of that
    // rank elsewhere does not count.
    const rankOf = (id: string) => { const m = /#(\d+)/.exec(byId.get(id)?.label ?? ''); return m ? Number(m[1]) : null; };
    const ranks = answer.sentences.flatMap((s, i) => {
        // Split keeping the delimiters: parts alternate clause, delimiter, clause, …
        const parts = s.text.split(new RegExp(`(${CLAUSE.source})`, 'gi'));
        const delimiters = parts.filter((_, n) => n % 2 === 1).map(d => d.trim());
        const clauses = parts.filter((_, n) => n % 2 === 0).map(c => ({
            stated: ORDINALS.flatMap((word, n) => new RegExp(`\\b${word}\\b`, 'i').test(c.replace(PLACEHOLDER, ' ')) ? [n + 1] : []),
            ranked: [...c.matchAll(PLACEHOLDER)].flatMap(([, id]) => { const r = rankOf(id); return r === null ? [] : [r]; }),
        }));
        return clauses.flatMap((c, k) => {
            if (!c.stated.length) return [];
            const matches = (ranked: number[]) => ranked.length > 0 && new Set(ranked).size === new Set(c.stated).size && ranked.every(r => c.stated.includes(r));
            // Backward only for a true appositive: a comma before the phrase, and a comma or the sentence end after it.
            const before = clauses[k - 1]?.ranked ?? [];
            const appositive = k > 0 && delimiters[k - 1] === ',' && (k === clauses.length - 1 || delimiters[k] === ',') && before.length > 0;
            const same = matches(c.ranked.length ? c.ranked : appositive ? before : clauses[k + 1]?.ranked ?? []);
            return same ? [] : [`sentence ${i + 1}: "${ORDINALS[c.stated[0] - 1]}" is not the rank of the entity it describes`];
        });
    });
    if (!gate('ranks', 'Rank words match the rank of a cited fact', ranks)) return result('WITHHELD');

    // 4. Entities: a known name must come from a cited fact; any other proper name must appear in the question or the facts.
    const cited = [...new Set(answer.sentences.flatMap(s => s.cites).flatMap(c => derivedById.get(c)?.from ?? [c]))];
    const citedText = cited.flatMap(id => Object.values(byId.get(id)!.fields).filter(v => v.kind === 'TEXT').map(v => (v as { text: string }).text.toLowerCase()));
    const known = [ctx.catalogue.scope.businessName, ...ctx.catalogue.counterparties];
    const corpus = [ctx.question, ...facts.map(f => f.label), ...citedText, ...known].join(' ').toLowerCase();
    const entityProblems: string[] = [];
    for (const [i, t] of free.entries()) {
        for (const name of ctx.catalogue.counterparties) if (t.toLowerCase().includes(name.toLowerCase()) && !citedText.some(v => v.includes(name.toLowerCase()))) entityProblems.push(`sentence ${i + 1}: names ${name} without citing a fact about it`);
        const words = t.trim().split(/\s+/).slice(1).map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z'&]+$/g, '')).filter(w => /^[A-Z]/.test(w));
        for (const w of words) if (!VOCABULARY.has(w) && !corpus.includes(w.toLowerCase())) entityProblems.push(`sentence ${i + 1}: unrecognised name "${w}"`);
    }
    if (!gate('entities', 'Every named counterparty or entity comes from a cited fact', entityProblems)) return result('WITHHELD');

    // 5. No conclusion the cash records cannot support (accounting classification, cause, advice, allegation).
    const plainText = free.map(t => withoutNames(t, known));
    const conclusions = plainText.flatMap((t, i) => { const m = t.match(CONCLUSIONS); return m ? [`sentence ${i + 1}: "${m[0]}"`] : []; });
    if (!gate('conclusions', 'No unsupported accounting conclusion, cause, advice or allegation', conclusions)) return result('WITHHELD');
    // 5b. No role or category the records do not contain (a correctly cited payee is not thereby a "supplier"),
    // unless the question itself used that word about a counterparty it named.
    const questionTerms = new Set((withoutNames(ctx.question, known).match(new RegExp(CLASSIFICATION, 'gi')) ?? []).map(w => w.toLowerCase()));
    const classification = plainText.flatMap((t, i) => (t.match(new RegExp(CLASSIFICATION, 'gi')) ?? []).filter(w => !questionTerms.has(w.toLowerCase()) || !namedCounterparties(ctx.question, ctx.catalogue.counterparties).length).map(w => `sentence ${i + 1}: "${w}" is not a classification the records contain`));
    if (!gate('classification', 'No supplier, customer, employee or payment-category claim the records do not contain', classification)) return result('WITHHELD');
    // 5c. A comparison stated with a negative amount reads as a double negative ("lower than the ledger by −MYR 2,692.92").
    const COMPARISON = /\b(lower|higher|less|more|greater|smaller|below|above|exceed\w*|short\w*|behind|ahead)\b/i;
    const negative = (s: { text: string }) => [...s.text.matchAll(PLACEHOLDER)].some(([, id, field]) => { const v = byId.get(id) ? fieldOf(byId.get(id)!, field) : derivedById.get(id)?.value; return v?.kind === 'MONEY' && v.cents.startsWith('-'); });
    const signWording = answer.sentences.flatMap((s, i) => COMPARISON.test(free[i]) && negative(s) ? [`sentence ${i + 1}: "${free[i].match(COMPARISON)![0]}" with a negative amount`] : []);
    if (!gate('sign-wording', 'Comparisons are not stated with a negative amount', signWording)) return result('WITHHELD');

    // 6. What the question names (a counterparty or a month) must be what the cited facts are about.
    const q = ctx.question.toLowerCase(), citedFacts = cited.map(id => byId.get(id)!);
    const about = (needle: string) => citedFacts.some(f => f.label.toLowerCase().includes(needle) || Object.values(f.fields).some(v => formatValue(v).toLowerCase().includes(needle)));
    const asked = namedCounterparties(q, ctx.catalogue.counterparties).map(n => n.toLowerCase());
    const relevance = asked.filter(n => !about(n)).map(n => `the question names ${n} but no cited fact is about it`);
    if (!gate('relevance', 'Cited facts are about what the question names', relevance)) return result('WITHHELD');

    // Render: code substitutes every value.
    const sentences = answer.sentences.map(s => {
        const out: Segment[] = []; let last = 0;
        for (const m of s.text.matchAll(PLACEHOLDER)) {
            if (m.index! > last) out.push({ text: s.text.slice(last, m.index) });
            const [, id, field] = m, f = byId.get(id), d = derivedById.get(id)!;
            out.push(f ? { value: formatValue(fieldOf(f, field)), ref: field ? `${id}.${field}` : id, label: f.label, sources: f.sources } : { value: formatValue(d.value), ref: id, label: d.label, sources: d.from.flatMap(x => byId.get(x)!.sources) });
            last = m.index! + m[0].length;
        }
        if (last < s.text.length) out.push({ text: s.text.slice(last) });
        return out;
    });
    return result('ACCEPTED', { sentences, cited, derived });
}
