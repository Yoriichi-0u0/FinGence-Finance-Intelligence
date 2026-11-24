'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, LoaderCircle, Printer, ShieldAlert, Sparkles } from 'lucide-react';
import { LineChart } from '@/components/charts';
import { PageHeader } from '@/components/ui';
import { useDemoProcessing } from '@/components/demo/context';
import { Stat, Table, button, money, outflow, periodLabel, primaryButton, resultsEyebrow, usesOwnDocuments } from '@/components/demo/shared';
import { useTechnicalDetail } from '@/components/workspace/context';
import { AI_REPORT_SECTIONS, AI_REPORT_STORE, AI_REPORT_VERSION, precedingMonths, waitableLimit, writeReportSection, type AiReportSectionId } from '@/lib/ai-report/sections';
import { processingConfidence } from '@/lib/confidence';
import { CONFIDENCE_DEFINITION } from '@/components/demo/confidence';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { gatewayQaModel, qaGatewayStatus, type GroundedRun, type QaGatewayStatus } from '@/lib/grounded-qa/client';
import type { Segment } from '@/lib/grounded-qa/gates';
import { groundingIndex } from '@/lib/grounded-qa/tools';
import { RULES } from '@/lib/poc-anomalies/detector';
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
 * One report section: the AI paragraph when it passed every check, otherwise FinGence's own sentence, then the
 * figures and tables computed by code. The figures never depend on the model.
 */
function Section({ id, number, title, run, writing, fallback, children }: { id: AiReportSectionId; number: number; title: string; run?: GroundedRun; writing: boolean; fallback: string; children?: React.ReactNode }) {
    const accepted = run?.status === 'ANSWERED' && run.verdict?.sentences ? run.verdict.sentences : null;
    return <section aria-labelledby={`ai-report-${id}`} className="break-inside-avoid-page border-b border-[var(--border)] py-6 last:border-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id={`ai-report-${id}`} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-ink)]">{number}. {title}</h2>
            <SectionStatus run={run} writing={writing} />
        </div>
        {accepted ? <Paragraph sentences={accepted} /> : <p className="text-[15px] leading-7 text-[var(--ink)]">{fallback}</p>}
        {run && !accepted && run.status !== 'UNAVAILABLE' ? <p className="mt-1 text-xs text-[var(--muted)] print:hidden">The AI paragraph did not pass FinGence&apos;s checks, so FinGence&apos;s own summary is shown instead.</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
    </section>;
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
    const forecast = rep.forecast, prior = useMemo(() => priorPeriod(c), [c]);

    const fallback: Record<AiReportSectionId, string> = {
        summary: `In ${periodLabel(s.period)}, cash in was ${money(cur, rep.cash.credits)} and cash out ${outflow(cur, rep.cash.debits)}, a net movement of ${money(cur, rep.cash.net)}. ${matched} of ${r.results.length} records matched the books directly${o.resolution ? `; FinGence's stated rules resolved ${Math.max(0, resolvedByRule)} of the ${exceptions} exceptions and ${unexplained} remain${unexplained === 1 ? 's' : ''} unexplained` : `, with ${exceptions} exceptions`}. ${flagged} bank record${flagged === 1 ? ' is' : 's are'} marked for a second look.${forecast.status === 'AVAILABLE' ? ` The next-month baseline is a net ${money(cur, forecast.net)}.` : ''}`,
        cash: `Cash in was ${money(cur, rep.cash.credits)} across ${rep.cash.creditRows} receipts and cash out ${outflow(cur, rep.cash.debits)} across ${rep.cash.debitRows} payments.${into[0] ? ` The most money came from ${into[0].name} (${money(cur, fromCents(into[0].total))}).` : ''}${outOf[0] ? ` The most money went to ${outOf[0].name} (${money(cur, fromCents(outOf[0].total))}).` : ''}`,
        reconciliation: `Bank movement of ${money(cur, r.cashMovement.bank)} against ledger movement of ${money(cur, r.cashMovement.ledger)} leaves a difference of ${money(cur, r.cashMovement.signedDifference)}. ${matched} records matched directly and the matcher raised ${exceptions} exceptions${o.resolution ? `; after FinGence's stated rules, ${unexplained} remain${unexplained === 1 ? 's' : ''} unexplained. ${o.resolution.summary}` : '.'}`,
        review: resolution ? `${resolution.items.length} bank record${resolution.items.length === 1 ? ' was' : 's were'} marked by a rule: the books confirm ${confirmed}, and ${flagged} remain${flagged === 1 ? 's' : ''} open for a second look. A mark is a reason to review, not a finding.` : `${o.anomalies.length} bank record${o.anomalies.length === 1 ? ' is' : 's are'} marked for a second look. A mark is a reason to review, not a finding.`,
        outlook: forecast.status === 'AVAILABLE' ? `For ${periodLabel(forecast.period)}, the baseline is cash in ${money(cur, forecast.credits)} and cash out ${outflow(cur, forecast.debits)}, a net ${money(cur, forecast.net)}. It is an average of recent months, not a prediction.` : `No baseline is available: ${forecast.detail}`,
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
    const sectionProps = (id: AiReportSectionId) => ({ id, number: AI_REPORT_SECTIONS.findIndex(x => x.id === id) + 1, title: AI_REPORT_SECTIONS.find(x => x.id === id)!.title, run: runs[id], writing: writing?.section === id, fallback: fallback[id] });

    return <>
        <PageHeader eyebrow={resultsEyebrow(s)} title="AI report" description="A period report in the style of a listed company’s quarterly or annual report, written by AI over your verified figures. FinGence fills in every figure and checks every sentence." actions={<div className="flex flex-wrap gap-2 print:hidden">
            {canWrite ? <button type="button" className={primaryButton} disabled={!!writing} onClick={() => void write()}>{writing ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}{writing ? writing.waiting ? 'Waiting for the AI service…' : `Writing ${writing.done + 1} of ${AI_REPORT_SECTIONS.length}…` : attempted ? 'Write again' : 'Write with AI'}</button> : null}
            <button type="button" className={canWrite ? button : primaryButton} onClick={() => window.print()}><Printer aria-hidden="true" size={16} />Print or save PDF</button>
        </div>} />

        {!canWrite ? <p role="note" className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--muted-strong)] print:hidden">AI writing is not switched on here, so each section shows FinGence&apos;s own summary. The figures are the same either way.</p>
            : !attempted && !writing ? <p role="note" className="mb-5 flex items-start gap-2 rounded-xl border border-[var(--brand-line)] bg-[var(--brand-soft)] p-4 text-sm text-[var(--brand-ink)] print:hidden"><CircleDashed aria-hidden="true" className="mt-0.5 shrink-0" size={16} />Choose &ldquo;Write with AI&rdquo; to have {status.available ? status.model : 'the model'} write each section. It sees only the verified facts for that section, never your full records, and any sentence that fails a check is replaced by FinGence&apos;s own summary.</p>
            : attempted && !writing ? <p role="status" className="mb-5 text-sm text-[var(--muted-strong)] print:hidden">{written} of {AI_REPORT_SECTIONS.length} sections written by AI{written < attempted ? '; the rest show FinGence’s own summary' : ''}.</p> : null}

        <article aria-label={`AI report for ${s.businessName}, ${periodLabel(s.period)}`} className="panel-shadow rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-8 print:border-0 print:p-0 print:shadow-none">
            <header className="border-b border-[var(--border)] pb-6">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-ink)]">{reportKind(s.months)}</p>
                <h2 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[32px]">{s.businessName}</h2>
                <p className="mt-1 text-base text-[var(--muted-strong)]">Cash report {periodEnded(s.months)} · in {cur}</p>
                <p className="mt-3 text-xs text-[var(--muted)]">Unaudited · prepared by FinGence from the verified bank statement and ledger{processedAt ? ` on ${new Date(processedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''} · {usesOwnDocuments(c) ? 'From your documents' : 'From the fictional sample documents'} · {confidence.status === 'MEASURED' ? `${confidence.percent}% confidence (${confidence.band === 'HIGH' ? 'High' : confidence.band === 'CHECK' ? 'Check advised' : 'Low'})` : 'Confidence incomplete'} · a draft for review, not for financial publication.</p>
            </header>

            <div className="grid grid-cols-1 gap-3 py-6 sm:grid-cols-2 2xl:grid-cols-4">
                <Stat label="Cash in" value={money(cur, rep.cash.credits)} detail={`${rep.cash.creditRows} receipts`} tone="good" />
                <Stat label="Cash out" value={outflow(cur, rep.cash.debits)} detail={`${rep.cash.debitRows} payments`} tone="warn" />
                <Stat label="Net movement" value={money(cur, rep.cash.net)} detail="Cash in minus cash out" tone="brand" />
                <Stat label="Matched with the books" value={`${rate}%`} detail={`${matched} of ${r.results.length} records directly${o.resolution ? ` · ${unexplained} unexplained after rules` : ''}`} tone={unexplained ? 'warn' : 'good'} />
            </div>

            {prior ? <section aria-labelledby="ai-report-highlights" className="border-b border-[var(--border)] pb-6">
                <h2 id="ai-report-highlights" className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-ink)]">Summary of results</h2>
                <Table caption={`${periodLabel(s.period)} against the preceding period, ${periodLabel(prior.months.length > 1 ? `${prior.months[0]}/${prior.months.at(-1)}` : prior.months[0])}`} stack={false} numeric={[1, 2, 3, 4]} columns={[`In ${cur}`, periodLabel(s.period), periodLabel(prior.months.length > 1 ? `${prior.months[0]}/${prior.months.at(-1)}` : prior.months[0]), 'Increase (decrease)', '%']} rows={([['Cash in', rep.cash.credits, prior.totals.credits], ['Cash out', rep.cash.debits.replace(/^-/, ''), prior.totals.debits.replace(/^-/, '')], ['Net movement', rep.cash.net, prior.totals.net]] as const).map(([label, now, before]) => { const d = change(now, before); return [label, money(cur, now), money(cur, before), money(cur, fromCents(d.delta)), d.percent]; }).concat([['Receipts', String(rep.cash.creditRows), String(prior.totals.creditRows), String(rep.cash.creditRows - prior.totals.creditRows), '—'], ['Payments', String(rep.cash.debitRows), String(prior.totals.debitRows), String(rep.cash.debitRows - prior.totals.debitRows), '—']])} />
            </section> : null}

            <Section {...sectionProps('summary')} />

            <Section {...sectionProps('cash')}>
                {months.length > 1 ? <div className="mb-4 rounded-2xl border border-[var(--border)] p-3"><LineChart ariaLabel="Cash in and cash out by month" labels={months.map(m => m.p.slice(2))} series={[{ label: 'Cash in', color: 'var(--chart-in)', values: months.map(m => Number(m.credits)) }, { label: 'Cash out', color: 'var(--chart-out)', values: months.map(m => -Number(m.debits)) }]} height={220} /></div> : null}
                {months.length > 1 ? <div className="mb-4"><Table caption="Cash by month" stack={false} numeric={[1, 2, 3]} columns={['Month', 'Cash in', 'Cash out', 'Net']} rows={months.slice(-6).map(m => [periodLabel(m.p), money(cur, m.credits), outflow(cur, m.debits), money(cur, m.net)])} /></div> : null}
                <div className="grid gap-4 md:grid-cols-2">
                    <Table caption="Largest sources of cash in" stack={false} numeric={[1, 2]} columns={['Received from', 'Amount', 'Share']} rows={into.map(x => [x.name, money(cur, fromCents(x.total)), share(x.total, rep.cash.credits)])} />
                    <Table caption="Largest uses of cash out" stack={false} numeric={[1, 2]} columns={['Paid to', 'Amount', 'Share']} rows={outOf.map(x => [x.name, money(cur, fromCents(x.total)), share(x.total, rep.cash.debits)])} />
                </div>
            </Section>

            <Section {...sectionProps('reconciliation')}>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    {[['Bank movement', money(cur, r.cashMovement.bank)], ['Ledger movement', money(cur, r.cashMovement.ledger)], ['Difference', money(cur, r.cashMovement.signedDifference)]].map(([k, v]) => <div key={k} className="rounded-xl bg-[var(--surface-subtle)] p-3"><dt className="text-xs text-[var(--muted)]">{k}</dt><dd className="mt-1 font-semibold tabular-nums">{v}</dd></div>)}
                </dl>
                {periods.length ? <ul className="mt-3 space-y-1 text-sm">{periods.map(({ period, statement: st }) => <li key={period}>{periods.length > 1 ? `${periodLabel(period)}: ` : ''}{st.explained ? 'the difference is fully explained by stated rules (timing items and proposed ledger corrections).' : `${money(cur, st.unexplained)} of the difference is not explained by any rule.`}</li>)}</ul> : null}
                {o.notReconciled.length ? <p className="mt-2 text-xs text-[var(--muted)]">Not reconciled, because only one document covers it: {o.notReconciled.map(n => `${periodLabel(n.period)} (${n.side === 'BANK' ? 'bank statement only' : 'books only'})`).join(', ')}.</p> : null}
                <p className="mt-2 text-sm"><Link href="/reconciliation" className="font-semibold text-[var(--brand-ink)] underline underline-offset-2 print:no-underline">See every record on Reconciliation</Link></p>
            </Section>

            <Section {...sectionProps('review')}>
                {flaggedItems.length ? <Table caption="Bank records still open for a second look" stack={false} numeric={[2]} columns={['Date', 'Counterparty', 'Amount', 'Why it was marked']} rows={flaggedItems.slice(0, 5).map(i => [i.row.date, i.row.counterparty, money(cur, i.row.amount), i.findings.map(f => RULES[f.ruleId].title).join('; ')])} />
                    : <p className="text-sm text-[var(--muted-strong)]">No bank record is still open for a second look.</p>}
            </Section>

            <Section {...sectionProps('outlook')} />

            <section aria-labelledby="ai-report-basis" className="pt-6">
                <h2 id="ai-report-basis" className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-ink)]">Notes: basis of preparation</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--muted-strong)]">
                    <li>This report is prepared on a cash basis from the bank statement and general ledger named here: {rep.sources.map(x => x.name).join(', ')}. It is not audited, and it is not a statement of profit or loss, financial position or cash flows.</li>
                    <li>Comparatives are the same number of months immediately before this period, taken from the verified bank history{prior ? '' : '; none were available for this report'}.</li>
                    <li>{CONFIDENCE_DEFINITION}</li>
                    <li>Every figure is computed by FinGence from the verified records. Where a section says it was written by AI, the model chose only the words; FinGence filled in each figure and checked each sentence, and replaces any sentence that fails with its own summary.</li>
                    {rep.limitations.map(l => <li key={l}>{l}</li>)}
                    {technical ? <li>Processing {c.processingId} · {c.version} · {AI_REPORT_VERSION}{Object.values(runs).flatMap(x => x?.receipts ?? []).length ? ` · ${Object.values(runs).flatMap(x => x?.receipts ?? []).length} model calls (${[...new Set(Object.values(runs).flatMap(x => x?.receipts ?? []).map(x => x.model))].join(', ')})` : ''}</li> : null}
                </ul>
            </section>
        </article>
    </>;
}
