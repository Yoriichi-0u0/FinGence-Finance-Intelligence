'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, LoaderCircle, Printer, ShieldAlert, Sparkles } from 'lucide-react';
import { LineChart } from '@/components/charts';
import { PageHeader } from '@/components/ui';
import { useDemoProcessing } from '@/components/demo/context';
import { Table, button, money, outflow, periodLabel, primaryButton, resultsEyebrow, usesOwnDocuments } from '@/components/demo/shared';
import { useTechnicalDetail } from '@/components/workspace/context';
import { AI_REPORT_SECTIONS, AI_REPORT_STORE, AI_REPORT_VERSION, precedingMonths, waitableLimit, writeReportSection, type AiReportSectionId } from '@/lib/ai-report/sections';
import { processingConfidence } from '@/lib/confidence';
import { CONFIDENCE_DEFINITION } from '@/components/demo/confidence';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { gatewayQaModel, qaGatewayStatus, type GroundedRun, type QaGatewayStatus } from '@/lib/grounded-qa/client';
import type { Segment } from '@/lib/grounded-qa/gates';
import { groundingIndex } from '@/lib/grounded-qa/tools';
import { RULES } from '@/lib/poc-anomalies/detector';
import { reportDocument, type ReportDocument } from '@/lib/ai-report/document';
import { fromCents, toCents, type SourceRow } from '@/lib/poc-anomalies/source';
import { cashTotals, type BankTotals } from '@/lib/poc-insights/model';

type Ready = ProcessingContext & { scope: NonNullable<ProcessingContext['scope']>; outputs: ProcessingContext['outputs'] & { reconciliation: NonNullable<ProcessingContext['outputs']['reconciliation']>; totals: NonNullable<ProcessingContext['outputs']['totals']>; forecast: NonNullable<ProcessingContext['outputs']['forecast']>; report: NonNullable<ProcessingContext['outputs']['report']> } };
type Runs = Partial<Record<AiReportSectionId, GroundedRun>>;
type Writing = { section: AiReportSectionId | null; done: number; waiting: boolean };
/** A section stopped by a per-minute limit (Groq's, or FinGence's six calls a minute per person) waits and is tried again, for up to about a minute and a half. */
const RATE_WAIT_MS = 25_000, RATE_TRIES = 4;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function loadRuns(processingId: string): Runs {
    try {
        const stored = JSON.parse(sessionStorage.getItem(AI_REPORT_STORE) ?? 'null') as { version?: string; processingId?: string; runs?: Runs } | null;
        return stored?.version === AI_REPORT_VERSION && stored.processingId === processingId && stored.runs ? stored.runs : {};
    } catch { return {}; }
}
function saveRuns(processingId: string, runs: Runs) {
    try { sessionStorage.setItem(AI_REPORT_STORE, JSON.stringify({ version: AI_REPORT_VERSION, processingId, runs })); } catch { /* storage unavailable: the paragraphs last for this page only */ }
}

const abs = (v: bigint) => v < 0n ? -v : v;
/** Top counterparties by money received or paid, from the verified bank records. */
function topCounterparties(rows: SourceRow[], direction: 'Credit' | 'Debit', limit = 5) {
    const groups = new Map<string, { total: bigint; n: number }>();
    for (const r of rows) if (r.direction === direction) { const g = groups.get(r.counterparty) ?? { total: 0n, n: 0 }; g.total += abs(toCents(r.signedAmount)); g.n++; groups.set(r.counterparty, g); }
    return [...groups].map(([name, g]) => ({ name, ...g })).sort((a, b) => Number(b.total - a.total) || a.name.localeCompare(b.name)).slice(0, limit);
}

/** What the report is called, like a listed company's: monthly, quarterly (a calendar quarter) or annual. */
export function reportKind(months: string[]): string {
    const sorted = [...months].sort(), [y, m] = (sorted[0] ?? '').split('-').map(Number);
    if (sorted.length === 1) return 'Monthly report';
    if (sorted.length === 3 && (m - 1) % 3 === 0 && sorted[2] === `${y}-${String(m + 2).padStart(2, '0')}`) return `Quarterly report · Q${(m + 2) / 3} ${y}`;
    if (sorted.length === 12) return 'Annual report';
    return 'Period report';
}
const ORDINAL = ['first', 'second', 'third', 'fourth'];
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
/** "for the first quarter ended 31 March 2026", as a listed company's interim report is titled. */
export function periodEnded(months: string[]): string {
    const sorted = [...months].sort(), kind = reportKind(sorted), end = lastDay(sorted.at(-1) ?? '');
    if (kind.startsWith('Quarterly')) return `for the ${ORDINAL[(Number(sorted[0].split('-')[1]) - 1) / 3]} quarter ended ${end}`;
    if (kind === 'Monthly report') return `for the month ended ${end}`;
    if (kind === 'Annual report') return `for the twelve months ended ${end}`;
    return `for the ${sorted.length} months ended ${end}`;
}
/** The same number of months immediately before the report's months, when the verified history covers all of them. */
export function priorPeriod(c: Pick<ProcessingContext, 'outputs'> & { scope: { months: string[] } }): { months: string[]; totals: BankTotals } | null {
    const h = c.outputs.history;
    if (!h.accepted || !c.scope.months.length) return null;
    const months = precedingMonths(c.scope.months);
    if (!months.every(m => h.months.includes(m))) return null;
    return { months, totals: cashTotals(h.rows.filter(r => months.includes(r.period))) };
}
/** Change from the prior period, in money and in percent (one decimal), from exact cents. */
function change(now: string, before: string): { delta: bigint; percent: string } {
    const a = toCents(now), b = toCents(before), delta = a - b;
    if (b === 0n) return { delta, percent: '—' };
    const tenths = (delta * 1000n) / abs(b), shown = (Number(abs(tenths)) / 10).toFixed(1);
    return { delta, percent: tenths < 0n ? `(${shown})%` : `${shown}%` };
}

/** A counterparty's share of all cash in (or out), one decimal, from exact cents. */
const share = (part: bigint, whole: string) => { const w = abs(toCents(whole)); return w === 0n ? '—' : `${(Number((part * 1000n) / w) / 10).toFixed(1)}%`; };

/** The accepted AI paragraph: words by the model, every figure rendered by FinGence from a verified fact. */
function Paragraph({ sentences }: { sentences: Segment[][] }) {
    return <p className="text-[15px] leading-7 text-[var(--ink)]">{sentences.map((segments, i) => <span key={i}>{segments.map((s, j) => 'text' in s ? <span key={j}>{s.text}</span>
        : <mark key={j} title={`${s.label} · from ${s.sources.length} verified record${s.sources.length === 1 ? '' : 's'}`} className="rounded bg-[var(--teal-soft)] px-1 font-semibold tabular-nums text-[var(--brand-ink)] print:bg-transparent print:px-0">{s.value}</mark>)} </span>)}</p>;
}

function SectionStatus({ run, writing }: { run?: GroundedRun; writing: boolean }) {
    const tag = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold print:hidden';
    if (writing) return <span className={`${tag} bg-[var(--brand-soft)] text-[var(--brand-ink)]`}><LoaderCircle aria-hidden="true" className="animate-spin" size={13} />Writing</span>;
    if (!run) return null;
    if (run.status === 'ANSWERED') return <span className={`${tag} bg-[var(--good-soft)] text-[var(--good-ink)]`}><CheckCircle2 aria-hidden="true" size={13} />Written by AI · figures checked</span>;
    return <span className={`${tag} bg-[var(--warn-soft)] text-[var(--warn-ink)]`}><ShieldAlert aria-hidden="true" size={13} />{run.status === 'UNAVAILABLE' ? 'AI unavailable' : 'AI paragraph withheld'}</span>;
}

/**
 * One Part B note: the AI paragraph when it passed every check, otherwise FinGence's own sentence, then the figures
 * and tables computed by code. The figures never depend on the model.
 */
function Section({ id, code, title, run, writing, fallback, children }: { id: AiReportSectionId; code: string; title: string; run?: GroundedRun; writing: boolean; fallback: string; children?: React.ReactNode }) {
    const accepted = run?.status === 'ANSWERED' && run.verdict?.sentences ? run.verdict.sentences : null;
    return <section aria-labelledby={`ai-report-${id}`} className="report-note border-b border-[var(--border)] py-6 last:border-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id={`ai-report-${id}`} className="report-h3">{code} {title}</h3>
            <SectionStatus run={run} writing={writing} />
        </div>
        {accepted ? <Paragraph sentences={accepted} /> : <p className="text-[15px] leading-7 text-[var(--ink)]">{fallback}</p>}
        {run && !accepted && run.status !== 'UNAVAILABLE' ? <p className="mt-1 text-xs text-[var(--muted)] print:hidden">The AI paragraph did not pass FinGence&apos;s checks, so FinGence&apos;s own summary is shown instead.</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
    </section>;
}

/** A Part A note: FinGence's own words and figures. */
function Note({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
    return <section className="report-note border-b border-[var(--border)] py-5 last:border-0"><h3 className="report-h3 mb-2">{code} {title}</h3><div className="space-y-3 text-[14px] leading-6 text-[var(--ink)]">{children}</div></section>;
}

/** Published-accounts style: whole statement in the currency with two decimals, payments in brackets. */
const acct = (v: bigint | null) => v === null ? '—' : v < 0n ? `(${groupCents(-v)})` : groupCents(v);
const groupCents = (v: bigint) => { const s = fromCents(v), [w, f] = s.split('.'); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`; };
const variance = (now: bigint, before: bigint | null) => { if (before === null || before === 0n) return '—'; const t = ((now - before) * 1000n) / (before < 0n ? -before : before), v = Number(t < 0n ? -t : t) / 10; return t < 0n ? `(${v.toFixed(1)})` : v.toFixed(1); };

/** The statement of cash flows table, with group headings over its date columns, as Bursa interim reports print it. */
function CashFlowStatement({ doc, currency }: { doc: ReportDocument; currency: string }) {
    const cols = doc.columns, n = cols.length, cell = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap', label = 'py-1.5 pr-3 text-left';
    const row = (key: string, text: React.ReactNode, values: (bigint | null)[], tone: 'line' | 'total' | 'grand' = 'line') => <tr key={key} className={tone === 'line' ? '' : tone === 'total' ? 'border-t border-[var(--border-strong)] font-semibold' : 'border-y-2 border-[var(--ink)] font-bold'}>
        <th scope="row" className={`${label} font-normal ${tone === 'line' ? 'pl-4' : 'font-semibold'}`}>{text}</th>{values.map((v, i) => <td key={i} className={cell}>{acct(v)}</td>)}</tr>;
    return <div className="thin-scrollbar overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <caption className="sr-only">Statement of cash flows</caption>
            <thead>
                <tr className="text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]"><th className={label} />{doc.groups.map(g => <th key={g.label} colSpan={g.columns.length} className="px-2 pb-1 text-right font-semibold">{g.label}</th>)}</tr>
                <tr className="border-b border-[var(--border-strong)] text-[12px]"><th className={`${label} font-semibold text-[var(--muted)]`}>In {currency}</th>{cols.map(c => <th key={c.label + c.months[0]} className={`${cell} font-semibold`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
                {doc.statement.flatMap(s => [
                    <tr key={`${s.activity}-h`}><th colSpan={n + 1} scope="colgroup" className="pt-4 pb-1 text-left text-[12px] font-bold uppercase tracking-[0.05em]">Cash flows from {s.activity.toLowerCase()} activities</th></tr>,
                    ...s.receipts.map(l => row(`${s.activity}-r-${l.category}`, `Received: ${l.category}`, l.values)),
                    ...s.payments.map(l => row(`${s.activity}-p-${l.category}`, `Paid: ${l.category}`, l.values)),
                    row(`${s.activity}-n`, `Net cash ${s.net[0] < 0n ? 'used in' : 'from'} ${s.activity.toLowerCase()} activities`, s.net, 'total'),
                ])}
                <tr><td colSpan={n + 1} className="h-3" /></tr>
                {row('net', 'Net increase (decrease) in cash', doc.netIncrease, 'total')}
                {doc.closing.some(v => v !== null) ? <>{row('open', 'Cash and bank balances at the beginning of the period', doc.opening)}{row('close', 'Cash and bank balances at the end of the period', doc.closing, 'grand')}</> : null}
            </tbody>
        </table>
    </div>;
}

export function AiReport({ c }: { c: Ready }) {
    const technical = useTechnicalDetail(), { ai: processingAi, processedAt } = useDemoProcessing();
    const gateway = processingAi?.available ?? false;
    const [status, setStatus] = useState<QaGatewayStatus>({ available: false });
    const [runs, setRuns] = useState<Runs>({});
    const [writing, setWriting] = useState<Writing | null>(null);
    // Clearing or replacing the results unmounts this page: a report still being written must not save itself back.
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const index = useMemo(() => groundingIndex(c), [c]), confidence = useMemo(() => processingConfidence(c), [c]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration
    useEffect(() => { setRuns(loadRuns(c.processingId)); }, [c.processingId]);
    useEffect(() => { let live = true; if (gateway) void qaGatewayStatus('ai-report').then(s => { if (live) setStatus(s); }); return () => { live = false; }; }, [gateway]);

    const s = c.scope, o = c.outputs, rep = o.report, r = o.reconciliation, cur = s.currency;
    // The matcher's exceptions are not what remains open: the reconciliation layer resolves most by stated rules.
    const matched = r.counts.MATCH_EXACT + r.counts.MATCH_DATE_SHIFT, exceptions = r.results.length - matched;
    const unexplained = o.resolution ? o.resolution.totals.resolutions.UNEXPLAINED : exceptions, resolvedByRule = exceptions - unexplained;
    const rate = r.results.length ? Math.round((matched / r.results.length) * 1000) / 10 : 0;
    const months = useMemo(() => {
        const rows = o.history.accepted ? o.history.rows : s.months.length > 1 ? o.bankRows : [], list = o.history.accepted ? o.history.months : s.months.length > 1 ? s.months : [];
        return list.map(p => ({ p, ...cashTotals(rows.filter(x => x.period === p)) }));
    }, [o.history, o.bankRows, s.months]);
    const into = useMemo(() => topCounterparties(o.bankRows, 'Credit'), [o.bankRows]), outOf = useMemo(() => topCounterparties(o.bankRows, 'Debit'), [o.bankRows]);
    const resolution = o.anomalyResolution, flaggedItems = (resolution?.items ?? []).filter(i => i.resolution === 'FLAGGED');
    const flagged = resolution ? flaggedItems.length : o.anomalies.length, confirmed = resolution ? resolution.items.length - flaggedItems.length : 0;
    const periods = o.periods.length ? o.periods : o.statement ? [{ period: s.period, statement: o.statement }] : [];
    const forecast = rep.forecast, prior = useMemo(() => priorPeriod(c), [c]), doc = useMemo(() => reportDocument(c), [c]);
    const plan = o.cashPlan?.status === 'AVAILABLE' ? o.cashPlan : null, kind = reportKind(s.months), title = kind.startsWith('Quarterly') ? 'Quarterly report' : kind === 'Annual report' ? 'Annual report' : kind;

    const fallback: Record<AiReportSectionId, string> = {
        summary: `In ${periodLabel(s.period)}, cash in was ${money(cur, rep.cash.credits)} and cash out ${outflow(cur, rep.cash.debits)}, a net movement of ${money(cur, rep.cash.net)}. ${matched} of ${r.results.length} records matched the books directly${o.resolution ? `; FinGence's stated rules resolved ${Math.max(0, resolvedByRule)} of the ${exceptions} exceptions and ${unexplained} remain${unexplained === 1 ? 's' : ''} unexplained` : `, with ${exceptions} exceptions`}. ${flagged} bank record${flagged === 1 ? ' is' : 's are'} marked for a second look.${forecast.status === 'AVAILABLE' ? ` The next-month baseline is a net ${money(cur, forecast.net)}.` : ''}`,
        cash: `Cash in was ${money(cur, rep.cash.credits)} across ${rep.cash.creditRows} receipts and cash out ${outflow(cur, rep.cash.debits)} across ${rep.cash.debitRows} payments.${into[0] ? ` The most money came from ${into[0].name} (${money(cur, fromCents(into[0].total))}).` : ''}${outOf[0] ? ` The most money went to ${outOf[0].name} (${money(cur, fromCents(outOf[0].total))}).` : ''}`,
        reconciliation: `Bank movement of ${money(cur, r.cashMovement.bank)} against ledger movement of ${money(cur, r.cashMovement.ledger)} leaves a difference of ${money(cur, r.cashMovement.signedDifference)}. ${matched} records matched directly and the matcher raised ${exceptions} exceptions${o.resolution ? `; after FinGence's stated rules, ${unexplained} remain${unexplained === 1 ? 's' : ''} unexplained. ${o.resolution.summary}` : '.'}`,
        review: resolution ? `${resolution.items.length} bank record${resolution.items.length === 1 ? ' was' : 's were'} marked by a rule: the books confirm ${confirmed}, and ${flagged} remain${flagged === 1 ? 's' : ''} open for a second look. A mark is a reason to review, not a finding.` : `${o.anomalies.length} bank record${o.anomalies.length === 1 ? ' is' : 's are'} marked for a second look. A mark is a reason to review, not a finding.`,
        outlook: plan ? `For ${periodLabel(plan.projection[0].period)}, FinGence plans cash in of ${money(cur, plan.projection[0].receipts)} and cash out of ${outflow(cur, plan.projection[0].payments)}, a net ${money(cur, plan.projection[0].net)}${plan.projection[0].range ? `, typically within ± ${money(cur, plan.projection[0].range)}` : ''}.${plan.projection.at(-1)!.balance ? ` Cash and bank balances are planned at ${money(cur, plan.projection.at(-1)!.balance!)} by the end of ${periodLabel(plan.projection.at(-1)!.period)}.` : ''} The plan is built from recent months, category by category; it is not a promise.`
            : forecast.status === 'AVAILABLE' ? `For ${periodLabel(forecast.period)}, the baseline is cash in ${money(cur, forecast.credits)} and cash out ${outflow(cur, forecast.debits)}, a net ${money(cur, forecast.net)}. It is an average of recent months, not a prediction.` : `No baseline is available: ${forecast.detail}`,
    };

    async function write() {
        if (!index || writing) return;
        const next: Runs = {};
        setRuns({}); saveRuns(c.processingId, {});
        let done = 0;
        // One section at a time: each is one bounded call, admitted against the shared budget.
        for (const section of AI_REPORT_SECTIONS) {
            setWriting({ section: section.id, done, waiting: false });
            let run = await writeReportSection(index, gatewayQaModel, section.id);
            if (!mounted.current) return;
            for (let tries = 1; tries < RATE_TRIES && run.status === 'UNAVAILABLE' && waitableLimit(run.error); tries++) {
                setWriting({ section: section.id, done, waiting: true });
                await pause(RATE_WAIT_MS);
                setWriting({ section: section.id, done, waiting: false });
                if (!mounted.current) return;
                run = await writeReportSection(index, gatewayQaModel, section.id);
                if (!mounted.current) return;
            }
            next[section.id] = run;
            done++;
            setRuns({ ...next }); saveRuns(c.processingId, next);
        }
        setWriting(null);
    }

    const written = AI_REPORT_SECTIONS.filter(x => runs[x.id]?.status === 'ANSWERED').length, attempted = Object.keys(runs).length;
    const canWrite = status.available && !!index;

    const sectionProps = (id: AiReportSectionId, code: string) => ({ id, code, title: AI_REPORT_SECTIONS.find(x => x.id === id)!.title, run: runs[id], writing: writing?.section === id, fallback: fallback[id] });
    const running = `${s.businessName} · ${title} ${periodEnded(s.months)}`.replace(/["\\]/g, '');
    const preparedOn = processedAt ? new Date(processedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const compareLabel = doc?.columns[1]?.label;

    return <>
        {/* Print: A4 pages with a running header and page numbers; the cover and each Part start a new page. */}
        <style>{`@media print { @page { size: A4; margin: 16mm 14mm 18mm; @top-left { content: "${running}"; font: 8pt Inter, system-ui, sans-serif; color: #6b7280; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Inter, system-ui, sans-serif; color: #6b7280; } } @page :first { @top-left { content: none; } @bottom-right { content: none; } } .report-doc { font-size: 10.5pt; } .report-break { break-before: page; } .report-note, .report-doc tr, .report-keep { break-inside: avoid; } .report-cover { min-height: 245mm; } }`}</style>
        <div className="print:hidden"><PageHeader eyebrow={resultsEyebrow(s)} title="AI report" description="A report laid out like a Bursa-listed company’s quarterly or annual report: statements and notes computed by FinGence from your verified records, with commentary written by AI and every figure checked." actions={<div className="flex flex-wrap gap-2 print:hidden">
            {canWrite ? <button type="button" className={primaryButton} disabled={!!writing} onClick={() => void write()}>{writing ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}{writing ? writing.waiting ? 'Waiting for the AI service…' : `Writing ${writing.done + 1} of ${AI_REPORT_SECTIONS.length}…` : attempted ? 'Write again' : 'Write with AI'}</button> : null}
            <button type="button" className={canWrite ? button : primaryButton} onClick={() => window.print()}><Printer aria-hidden="true" size={16} />Print or save PDF</button>
        </div>} /></div>

        {!canWrite ? <p role="note" className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--muted-strong)] print:hidden">AI writing is not switched on here, so each section shows FinGence&apos;s own summary. The figures are the same either way.</p>
            : !attempted && !writing ? <p role="note" className="mb-5 flex items-start gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4 text-sm text-[var(--brand-ink)] print:hidden"><CircleDashed aria-hidden="true" className="mt-0.5 shrink-0" size={16} />Choose &ldquo;Write with AI&rdquo; to have {status.available ? status.model : 'the model'} write the commentary in Part B. It sees only the verified facts for each note, never your full records, and any sentence that fails a check is replaced by FinGence&apos;s own summary.</p>
            : attempted && !writing ? <p role="status" className="mb-5 text-sm text-[var(--muted-strong)] print:hidden">{written} of {AI_REPORT_SECTIONS.length} sections written by AI{written < attempted ? '; the rest show FinGence’s own summary' : ''}.</p> : null}

        <article aria-label={`${title} for ${s.businessName}, ${periodLabel(s.period)}`} className="report-doc panel-shadow rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none [&_.report-h2]:text-[14px] [&_.report-h2]:font-bold [&_.report-h2]:uppercase [&_.report-h2]:tracking-[0.06em] [&_.report-h3]:text-[13px] [&_.report-h3]:font-semibold [&_.report-h3]:uppercase [&_.report-h3]:tracking-[0.05em] [&_.report-h3]:text-[var(--brand-ink)]">
            {/* Cover */}
            <header className="report-cover flex flex-col justify-between gap-10 border-b-4 border-[var(--brand)] pb-8">
                <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-ink)]">{kind}</p>
                    <h2 className="mt-3 text-[30px] font-extrabold uppercase leading-tight tracking-[-0.01em] sm:text-[40px]">{s.businessName}</h2>
                    <p className="mt-3 text-[17px] font-semibold uppercase tracking-[0.04em] text-[var(--muted-strong)]">{title} {periodEnded(s.months)}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">Cash report · in {cur}</p>
                </div>
                {doc ? <div className="report-keep grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
                    {doc.highlights.map(h => <div key={h.label} className="rounded-2xl bg-[var(--brand-soft)] p-4 print:border print:border-[var(--border)]">
                        <p className="text-[12px] font-medium text-[var(--brand-ink)]">{h.label}</p>
                        <p className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em] tabular-nums">{h.label === 'Cash paid' || h.value >= 0n ? money(cur, fromCents(h.value < 0n ? -h.value : h.value)) : `(${money(cur, fromCents(-h.value))})`}</p>
                        <p className="mt-1 text-xs text-[var(--muted-strong)]">{h.prior !== null ? `${variance(h.label === 'Cash paid' ? -h.value : h.value, h.prior === null ? null : h.label === 'Cash paid' ? -h.prior : h.prior)}% · ${h.detail}` : h.detail}</p>
                    </div>)}
                </div> : null}
                <p className="text-xs leading-relaxed text-[var(--muted)]">Unaudited · prepared by FinGence from the verified bank statement and ledger{preparedOn ? ` on ${preparedOn}` : ''} · {usesOwnDocuments(c) ? 'from your documents' : 'from the fictional sample documents'} · {confidence.status === 'MEASURED' ? `${confidence.percent}% confidence (${confidence.band === 'HIGH' ? 'High' : confidence.band === 'CHECK' ? 'Check advised' : 'Low'})` : 'confidence incomplete'} · a draft for review, not for financial publication.</p>
            </header>

            {doc ? <section aria-labelledby="report-statement" className="report-break pt-8">
                <h2 id="report-statement" className="report-h2">Unaudited condensed statement of cash flows</h2>
                <p className="mt-2 mb-4 text-[13px] leading-6 text-[var(--muted-strong)]">FinGence presents the following unaudited statement of cash flows {periodEnded(s.months)}, prepared on the direct method from the verified bank records and classified by the categories in the business&apos;s own books. It should be read with the explanatory notes that follow.</p>
                <CashFlowStatement doc={doc} currency={cur} />
                <p className="mt-3 text-xs text-[var(--muted)]">Payments are shown in brackets. {doc.columns.length > 1 ? `The comparative column (${compareLabel}) is classified by payee from the same books. ` : ''}{doc.closing[0] !== null ? `Balances are the month-end running balances of ${plan?.balanceSource ?? 'the bank history'}, used because every running balance agrees with its records.` : 'No verified running balance was supplied, so opening and closing balances are not shown.'}</p>
            </section> : null}

            <section aria-labelledby="report-part-a" className="report-break pt-8">
                <h2 id="report-part-a" className="report-h2">Part A · Explanatory notes</h2>
                <Note code="A1" title="Basis of preparation">
                    <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--muted-strong)]">
                        <li>Prepared on a cash basis from the bank statement and general ledger named here: {rep.sources.map(x => x.name).join(', ')}. It is not audited, and it is not a statement of profit or loss or of financial position.</li>
                        <li>Every bank record takes the category the books give it, through the reconciliation; records the books do not show are named by stated bank rules. Operating, investing and financing follow a published rule.</li>
                        <li>{CONFIDENCE_DEFINITION}</li>
                        <li>Every figure is computed by FinGence from the verified records. Where a note says it was written by AI, the model chose only the words; FinGence filled in each figure and checked each sentence.</li>
                        {rep.limitations.map(l => <li key={l}>{l}</li>)}
                    </ul>
                </Note>
                <Note code="A2" title="Seasonal or cyclical factors">{doc?.notes.seasonal.length ? doc.notes.seasonal.map(t => <p key={t}>{t}</p>) : <p>Not enough verified months to describe a seasonal pattern.</p>}</Note>
                <Note code="A3" title="Unusual items">{doc?.notes.unusual.length ? <Table caption="Unusual items in the period" stack={false} numeric={[2]} columns={['When', 'Item', `Amount (${cur})`, 'Why it is listed']} rows={doc.notes.unusual.map(u => [u.when, u.label, acct(u.amount), u.why])} /> : <p>There were no unusual items in the period.</p>}</Note>
                <Note code="A4" title="Capital expenditure">{doc?.notes.investing.length ? <p>Cash paid for long-term assets in the period: {doc.notes.investing.map(l => `${l.category} ${money(cur, fromCents(-l.values[0]))}`).join('; ')}{doc.columns.length > 1 ? ` (${compareLabel}: ${doc.notes.investing.map(l => money(cur, fromCents(-(l.values[1] ?? 0n)))).join('; ')})` : ''}.</p> : <p>No cash was paid for long-term assets in the period.</p>}</Note>
                <Note code="A5" title="Borrowings and financing">{doc?.notes.financing.length ? <p>{doc.notes.financing.map(l => `${l.category}: ${acct(l.values[0])}${doc.columns.length > 1 ? ` (${compareLabel}: ${acct(l.values[1] ?? 0n)})` : ''}`).join('; ')} in {cur}.</p> : <p>No loan, dividend or capital movements in the period.</p>}</Note>
                <Note code="A6" title="Receipts by segment">{doc?.notes.segments.length ? <Table caption="Receipts by category" stack={false} numeric={doc.columns.map((_, i) => i + 1).concat(doc.columns.length > 1 ? [doc.columns.length + 1] : [])} columns={['Category', ...doc.columns.map(x => x.label), ...(doc.columns.length > 1 ? ['Var %'] : [])]} rows={doc.notes.segments.map(l => [l.category, ...l.values.map(v => groupCents(v)), ...(doc.columns.length > 1 ? [variance(l.values[0], l.values[1])] : [])])} /> : <p>No receipts classified by the books.</p>}</Note>
            </section>

            <section aria-labelledby="report-part-b" className="report-break pt-8">
                <h2 id="report-part-b" className="report-h2">Part B · Review and commentary</h2>
                <Section {...sectionProps('summary', 'B1')}>
                    {prior ? <Table caption={`Summary of results: ${periodLabel(s.period)} against ${periodLabel(prior.months.length > 1 ? `${prior.months[0]}/${prior.months.at(-1)}` : prior.months[0])}`} stack={false} numeric={[1, 2, 3, 4]} columns={[`In ${cur}`, periodLabel(s.period), periodLabel(prior.months.length > 1 ? `${prior.months[0]}/${prior.months.at(-1)}` : prior.months[0]), 'Increase (decrease)', '%']} rows={([['Cash in', rep.cash.credits, prior.totals.credits], ['Cash out', rep.cash.debits.replace(/^-/, ''), prior.totals.debits.replace(/^-/, '')], ['Net movement', rep.cash.net, prior.totals.net]] as const).map(([label, now, before]) => { const d = change(now, before); return [label, money(cur, now), money(cur, before), money(cur, fromCents(d.delta)), d.percent]; }).concat([['Receipts', String(rep.cash.creditRows), String(prior.totals.creditRows), String(rep.cash.creditRows - prior.totals.creditRows), '—'], ['Payments', String(rep.cash.debitRows), String(prior.totals.debitRows), String(rep.cash.debitRows - prior.totals.debitRows), '—']])} /> : null}
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Matched with the books', `${rate}%`], ['Records', `${matched} of ${r.results.length} directly`], ['After the rules', `${unexplained} unexplained after rules`], ['Marked for review', `${flagged} open · ${confirmed} confirmed`]].map(([k, v]) => <div key={k} className="rounded-xl bg-[var(--surface-subtle)] p-3"><dt className="text-xs text-[var(--muted)]">{k}</dt><dd className="mt-1 font-semibold tabular-nums">{v}</dd></div>)}</dl>
                </Section>
                <Section {...sectionProps('cash', 'B2')}>
                    {months.length > 1 ? <div className="report-keep mb-4 rounded-2xl border border-[var(--border)] p-3"><LineChart ariaLabel="Cash in and cash out by month" labels={months.slice(-12).map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--chart-in)', values: months.slice(-12).map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--chart-out)', values: months.slice(-12).map(m => -Number(m.debits)) }]} height={200} /></div> : null}
                    {months.length > 1 ? <div className="mb-4"><Table caption="Cash by month" stack={false} numeric={[1, 2, 3]} columns={['Month', 'Cash in', 'Cash out', 'Net']} rows={months.filter(m => s.months.includes(m.p)).map(m => [periodLabel(m.p), money(cur, m.credits), outflow(cur, m.debits), money(cur, m.net)])} /></div> : null}
                    <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
                        <Table caption="Largest sources of cash in" stack={false} numeric={[1, 2]} columns={['Received from', 'Amount', 'Share']} rows={into.map(x => [x.name, money(cur, fromCents(x.total)), share(x.total, rep.cash.credits)])} />
                        <Table caption="Largest uses of cash out" stack={false} numeric={[1, 2]} columns={['Paid to', 'Amount', 'Share']} rows={outOf.map(x => [x.name, money(cur, fromCents(x.total)), share(x.total, rep.cash.debits)])} />
                    </div>
                </Section>
                <Section {...sectionProps('reconciliation', 'B3')}>
                    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                        {[['Bank movement', money(cur, r.cashMovement.bank)], ['Ledger movement', money(cur, r.cashMovement.ledger)], ['Difference', money(cur, r.cashMovement.signedDifference)]].map(([k, v]) => <div key={k} className="rounded-xl bg-[var(--surface-subtle)] p-3"><dt className="text-xs text-[var(--muted)]">{k}</dt><dd className="mt-1 font-semibold tabular-nums">{v}</dd></div>)}
                    </dl>
                    {periods.length ? (() => { const open = periods.filter(p => !p.statement.explained); return <p className="mt-3 text-sm">{open.length ? `${periods.length - open.length} of ${periods.length} months are fully explained by stated rules; not yet explained: ${open.map(p => `${periodLabel(p.period)} (${money(cur, p.statement.unexplained)})`).join(', ')}.` : `${periods.length === 1 ? 'The difference is' : `In all ${periods.length} months, the difference is`} fully explained by stated rules: timing items, and ${doc?.notes.reconciliation.entries ?? 0} correcting entries prepared for the books${doc?.notes.reconciliation.open ? ` (${doc.notes.reconciliation.open} timing item${doc.notes.reconciliation.open === 1 ? '' : 's'} expected on the next statement)` : ''}.`}</p>; })() : null}
                    {o.notReconciled.length ? <p className="mt-2 text-xs text-[var(--muted)]">Not reconciled, because only one document covers it: {o.notReconciled.map(n => `${periodLabel(n.period)} (${n.side === 'BANK' ? 'bank statement only' : 'books only'})`).join(', ')}.</p> : null}
                    <p className="mt-2 text-sm print:hidden"><Link href="/reconciliation" className="font-semibold text-[var(--brand-ink)] underline underline-offset-2">See every record on Reconciliation</Link></p>
                </Section>
                <Section {...sectionProps('review', 'B4')}>
                    {flaggedItems.length ? <Table caption="Bank records still open for a second look" stack={false} numeric={[2]} columns={['Date', 'Counterparty', 'Amount', 'Why it was marked']} rows={flaggedItems.slice(0, 5).map(i => [i.row.date, i.row.counterparty, money(cur, i.row.amount), i.findings.map(f => RULES[f.ruleId].title).join('; ')])} />
                        : <p className="text-sm text-[var(--muted-strong)]">No bank record is still open for a second look.</p>}
                </Section>
                <Section {...sectionProps('outlook', 'B5')}>
                    {plan ? <Table caption="Cash plan for the next months (from the Forecasting page)" stack={false} numeric={[1, 2, 3, 4]} columns={['Month', 'Cash in', 'Cash out', 'Net', plan.projection[0].balance ? 'Cash at month end' : 'Change in cash']} rows={plan.projection.slice(0, kind === 'Annual report' ? 6 : 3).map(m => [periodLabel(m.period), money(cur, m.receipts), outflow(cur, m.payments), money(cur, m.net), m.balance ? `${money(cur, m.balance)}${m.range ? ` ± ${money(cur, m.range)}` : ''}` : money(cur, m.cumulativeNet)])} /> : null}
                </Section>
            </section>

            <footer className="border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
                <p>Prepared by FinGence{preparedOn ? ` on ${preparedOn}` : ''}. Unaudited; a draft for review, not for financial publication.</p>
                {technical ? <p className="mt-1">Processing {c.processingId} · {c.version} · {AI_REPORT_VERSION}{Object.values(runs).flatMap(x => x?.receipts ?? []).length ? ` · ${Object.values(runs).flatMap(x => x?.receipts ?? []).length} model calls (${[...new Set(Object.values(runs).flatMap(x => x?.receipts ?? []).map(x => x.model))].join(', ')})` : ''}</p> : null}
            </footer>
        </article>
    </>;
}
