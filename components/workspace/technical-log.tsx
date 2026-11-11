'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, ChevronRight, CircleAlert, Cpu, Download, FileText, LoaderCircle, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, chip, field, Stat, Table } from '@/components/demo/shared';
import { featureLabel } from '@/lib/ai-calls/features';
import { useWorkspace } from './context';

type LogDocument = { name: string; role: string | null; format: string; decision: string; method: string; model: string | null; receiptMode: string | null;
    inputTokens: number | null; outputTokens: number | null; estimatedUsd: number | string | null; checks: number; failedChecks: number };
type LogRun = { id: string; at: string; by: string | null; source: 'SERVER' | 'BROWSER'; jobId: string | null; durationMs: number | null; outcome: string | null; flagged: number | null;
    processingId: string; pipelineVersion: string; scope: { businessId?: string; businessName?: string; period?: string; currency?: string } | null; documents: LogDocument[];
    stages: { title: string; decision: string; failedChecks: number }[] };
type FailedJob = { id: string; at: string; by: string | null; error: string | null; documents: number };
type AiCall = { at: string; by: string | null; feature: string; provider: string; model: string; keyLabel: string | null; requestId: string | null; status: 'OK' | 'REFUSED' | 'RATE_LIMITED' | 'FAILED';
    verdict: string | null; reasonCode: string | null; inputTokens: number | null; outputTokens: number | null; estimatedUsd: number | string | null; latencyMs: number; jobId: string | null; processingId: string | null };
type Log = { organization: string; days: number; since: string; runs: LogRun[]; failedJobs: FailedJob[]; aiCalls: AiCall[] };
type Check = { id: string; label: string; passed: boolean; detail: string };
type RunDetail = { documents: { ordinal: number; name: string; checks: Check[]; disclosures: string[]; notes: string[]; reason: string; model_request_id: string | null }[] };

const RANGES = [[1, '24 hours'], [7, '7 days'], [30, '30 days'], [90, '90 days']] as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const usd = (v: number | string | null | undefined) => v === null || v === undefined ? '—' : `US$${Number(v).toFixed(4)}`;
const tokens = (a: number | null, b: number | null) => a === null && b === null ? '—' : `${(a ?? 0).toLocaleString()} in · ${(b ?? 0).toLocaleString()} out`;
const who = (email: string | null) => email ?? 'Someone (not recorded)';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const aiProblem = (c: AiCall) => c.status !== 'OK' || c.verdict === 'WITHHELD' || c.verdict === 'QUARANTINED';
const STATUS: Record<AiCall['status'], string> = { OK: 'answered', REFUSED: 'refused by the provider', RATE_LIMITED: 'turned away (rate limit)', FAILED: 'failed' };
const VERDICT: Record<string, string> = { ACCEPTED: 'accepted by the checks', QUARANTINED: 'set aside by the checks', ANSWERED: 'answer shown', WITHHELD: 'answer withheld by the checks' };
const METHOD: Record<string, string> = { EXACT_SIGNATURE: 'fixed rules', AI_LAYOUT_PROPOSAL: 'AI', NONE: 'not read' };

type Event = { kind: 'run'; at: string; run: LogRun; calls: AiCall[] } | { kind: 'failed'; at: string; job: FailedJob } | { kind: 'ai'; at: string; call: AiCall };

/** Admin and Superadmin: what FinGence and its AI did, in plain words, with the technical detail one click away. */
export function TechnicalLog() {
    const workspace = useWorkspace();
    const [days, setDays] = useState(7), [data, setData] = useState<Log | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false);
    const [show, setShow] = useState<'all' | 'ai' | 'problems'>('all'), [feature, setFeature] = useState(''), [person, setPerson] = useState('');
    const load = useCallback(async (range: number) => {
        setLoading(true);
        const res = await fetch(`/api/workspace/log?days=${range}`, { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as Log & { code?: string } | null;
        setLoading(false);
        if (!res?.ok || !body) { setError(body?.code === 'FORBIDDEN' ? 'The Technical log is for Admins and Superadmins.' : `The Technical log could not be loaded (${body?.code ?? res?.status ?? 'unreachable'}).`); return; }
        setData(body); setError(null);
    }, []);
    useEffect(() => { if (!workspace.loading) queueMicrotask(() => void load(days)); }, [workspace.loading, load, days]);

    const events = useMemo<Event[]>(() => {
        if (!data) return [];
        const jobCalls = new Map<string, AiCall[]>();
        for (const c of data.aiCalls) if (c.jobId) jobCalls.set(c.jobId, [...jobCalls.get(c.jobId) ?? [], c]);
        const runJobs = new Set(data.runs.flatMap(r => r.jobId ? [r.jobId] : []));
        return [
            ...data.runs.map(run => ({ kind: 'run' as const, at: run.at, run, calls: run.jobId ? jobCalls.get(run.jobId) ?? [] : [] })),
            ...data.failedJobs.map(job => ({ kind: 'failed' as const, at: job.at, job })),
            // A call made inside a job is shown with that job's run; every other call (Q&A, commentary, teammates' features) on its own.
            ...data.aiCalls.filter(c => !c.jobId || !runJobs.has(c.jobId)).map(call => ({ kind: 'ai' as const, at: call.at, call })),
        ].sort((a, b) => b.at.localeCompare(a.at));
    }, [data]);
    const people = useMemo(() => [...new Set(events.map(e => e.kind === 'run' ? e.run.by : e.kind === 'failed' ? e.job.by : e.call.by).filter((x): x is string => !!x))].sort(), [events]);
    const features = useMemo(() => [...new Set(data?.aiCalls.map(c => c.feature) ?? [])].sort(), [data]);
    const visible = events.filter(e => {
        const by = e.kind === 'run' ? e.run.by : e.kind === 'failed' ? e.job.by : e.call.by;
        if (person && by !== person) return false;
        if (feature && !(e.kind === 'ai' ? e.call.feature === feature : e.kind === 'run' && e.calls.some(c => c.feature === feature))) return false;
        if (show === 'ai') return e.kind === 'ai' || (e.kind === 'run' && (e.calls.length > 0 || e.run.documents.some(d => d.model)));
        if (show === 'problems') return e.kind === 'failed' || (e.kind === 'ai' && aiProblem(e.call)) || (e.kind === 'run' && (e.run.documents.some(d => d.decision !== 'AUTO_ACCEPTED') || (e.run.flagged ?? 0) > 0 || e.calls.some(aiProblem)));
        return true;
    });

    const header = <PageHeader eyebrow="Administration" title="Technical log" description={`What FinGence and its AI did${data ? ` for ${data.organization}` : ''}: every run, document and AI call. Never the documents' contents.`}
        actions={<div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => void load(days)} disabled={loading}>{loading ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> : <RefreshCw aria-hidden="true" size={16} />}Refresh</button>
            {data ? <button type="button" className={button} onClick={() => exportCsv(data)}><Download aria-hidden="true" size={16} />Export CSV</button> : null}</div>} />;
    if (error) return <>{header}<Panel><p className="p-4 text-sm sm:p-5">{error}</p></Panel></>;
    if (!data) return <>{header}<p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin" size={16} />Loading…</p></>;

    const docs = data.runs.flatMap(r => r.documents), byAi = docs.filter(d => d.method === 'AI_LAYOUT_PROPOSAL').length;
    const calls = data.aiCalls, problems = calls.filter(aiProblem).length;
    const cost = calls.reduce((s, c) => s + Number(c.estimatedUsd ?? 0), 0), usedTokens = calls.reduce((s, c) => s + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
    return <>
        {header}
        <div role="group" aria-label="Time range" className="mb-5 flex flex-wrap gap-2">{RANGES.map(([n, label]) => <button key={n} type="button" aria-pressed={days === n} className={chip(days === n)} onClick={() => setDays(n)}>Last {label}</button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat tone="brand" icon={<Server aria-hidden="true" size={14} />} label="Runs" value={String(data.runs.length)} detail={`${data.runs.filter(r => r.source === 'SERVER').length} on the server${data.failedJobs.length ? ` · ${plural(data.failedJobs.length, 'job')} stopped` : ''}`} />
            <Stat tone="brand" icon={<FileText aria-hidden="true" size={14} />} label="Documents read" value={String(docs.length)} detail={`${docs.length - byAi} by fixed rules · ${byAi} by AI`} />
            <Stat tone={problems ? 'warn' : 'good'} icon={<Bot aria-hidden="true" size={14} />} label="AI calls" value={String(calls.length)} detail={problems ? `${problems} refused, failed or withheld` : 'None refused, failed or withheld'} />
            <Stat tone="plain" icon={<Cpu aria-hidden="true" size={14} />} label="Estimated AI cost" value={usd(cost)} detail={`${usedTokens.toLocaleString()} tokens`} />
        </div>
        <Panel className="mt-5" title="AI calls per day" eyebrow={`Last ${RANGES.find(([n]) => n === days)?.[1]}`}><DailyCalls calls={calls} days={days} /></Panel>
        <div className="mb-3 mt-6 flex flex-wrap items-end gap-2">
            <div role="group" aria-label="Show" className="flex flex-wrap gap-2">{([['all', 'Everything'], ['ai', 'AI only'], ['problems', 'Problems']] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} className={chip(show === k)} onClick={() => setShow(k)}>{label}</button>)}</div>
            <label className="ml-auto grid gap-1 text-xs font-medium text-[var(--muted-strong)]">Feature<select className={`${field} min-w-44`} value={feature} onChange={e => setFeature(e.target.value)}><option value="">All features</option>{features.map(f => <option key={f} value={f}>{featureLabel(f)}</option>)}</select></label>
            <label className="grid gap-1 text-xs font-medium text-[var(--muted-strong)]">Person<select className={`${field} min-w-44`} value={person} onChange={e => setPerson(e.target.value)}><option value="">Everyone</option>{people.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        </div>
        <Panel title="What happened" eyebrow={plural(visible.length, 'event')}>
            {visible.length ? <ol className="divide-y divide-[var(--border)]">{visible.map(e => <li key={e.kind === 'run' ? e.run.id : e.kind === 'failed' ? e.job.id : `${e.call.at}-${e.call.requestId ?? e.call.feature}`}><EventRow event={e} /></li>)}</ol>
                : <p className="flex items-center gap-2.5 p-5 text-sm text-[var(--muted-strong)]"><ShieldCheck aria-hidden="true" size={18} className="text-[var(--good)]" />{show === 'problems' ? 'No problems in this period.' : 'Nothing happened in this period.'}</p>}
        </Panel>
        <p className="mt-4 text-xs text-[var(--muted)]">Kept for 90 days. Only metadata is recorded: which feature, model and key, tokens, cost, time and outcome. Questions, answers, document contents and amounts are never stored here.</p>
    </>;
}

/** Calls per day, stacked: answered (brand) and refused, failed or withheld (warning), with the numbers in each bar's label. */
function DailyCalls({ calls, days }: { calls: AiCall[]; days: number }) {
    const buckets = useMemo(() => {
        const n = Math.min(days, 30), today = new Date(); today.setHours(0, 0, 0, 0);
        return Array.from({ length: n }, (_, i) => {
            const start = new Date(today); start.setDate(today.getDate() - (n - 1 - i));
            const end = new Date(start); end.setDate(start.getDate() + 1);
            const inDay = calls.filter(c => { const t = new Date(c.at); return t >= start && t < end; });
            return { label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ok: inDay.filter(c => !aiProblem(c)).length, problem: inDay.filter(aiProblem).length };
        });
    }, [calls, days]);
    const max = Math.max(1, ...buckets.map(b => b.ok + b.problem));
    if (!calls.length) return <p className="p-4 text-sm text-[var(--muted-strong)] sm:p-5">No AI calls in this period.</p>;
    return <div className="p-4 sm:p-5">
        <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={`AI calls per day: ${buckets.map(b => `${b.label} ${b.ok} answered, ${b.problem} with a problem`).join('; ')}`}>
            {buckets.map(b => <div key={b.label} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.label}: ${b.ok} answered, ${b.problem} refused, failed or withheld`}>
                {b.problem ? <span className="block rounded-t-[4px] bg-[var(--warn)]" style={{ height: `${(b.problem / max) * 100}%` }} /> : null}
                {b.ok ? <span className={`block bg-[var(--chart-in)] ${b.problem ? 'mt-[2px]' : 'rounded-t-[4px]'}`} style={{ height: `${(b.ok / max) * 100}%` }} /> : null}
            </div>)}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)] tabular-nums"><span>{buckets[0]?.label}</span><span>{buckets.at(-1)?.label}</span></div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted-strong)]">
            <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-[var(--chart-in)]" />Answered</span>
            <span className="inline-flex items-center gap-2"><CircleAlert aria-hidden="true" size={13} className="text-[var(--warn)]" />Refused, failed or withheld</span>
        </div>
    </div>;
}

function EventRow({ event: e }: { event: Event }) {
    const [detail, setDetail] = useState<RunDetail | null>(null), [opened, setOpened] = useState(false);
    if (e.kind === 'failed') return <div className="flex gap-3 px-4 py-3.5 text-sm sm:px-5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--bad-soft)] text-[var(--bad)]"><CircleAlert aria-hidden="true" size={16} /></span>
        <div className="min-w-0"><p className="font-semibold">A server job with {plural(e.job.documents, 'document')} stopped</p>
            <p className="text-xs text-[var(--muted)]">{when(e.job.at)} · {who(e.job.by)} · reason <code>{e.job.error ?? 'unknown'}</code>. Nothing from it was kept as a result.</p></div>
    </div>;
    if (e.kind === 'ai') {
        const c = e.call, bad = aiProblem(c);
        return <details className="group">
            <summary className="flex cursor-pointer gap-3 px-4 py-3.5 text-sm hover:bg-[var(--surface-subtle)] sm:px-5">
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${bad ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--brand-soft)] text-[var(--brand)]'}`}><Bot aria-hidden="true" size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block font-semibold">{featureLabel(c.feature)}: {c.model} {STATUS[c.status]}{c.verdict ? `, ${VERDICT[c.verdict] ?? c.verdict}` : ''}</span>
                    <span className="block text-xs text-[var(--muted)]">{when(c.at)} · {who(c.by)} · {(c.latencyMs / 1000).toFixed(1)} s · {usd(c.estimatedUsd)}</span></span>
                <ChevronRight aria-hidden="true" size={16} className="disclosure-chevron mt-1 shrink-0 text-[var(--muted)] transition-transform" />
            </summary>
            <dl className="mx-4 mb-4 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl bg-[var(--surface-subtle)] p-3 text-xs ring-1 ring-inset ring-[var(--border)] sm:mx-5">
                {([['Feature', `${featureLabel(c.feature)} (${c.feature})`], ['Provider and model', `${c.provider} · ${c.model}`], ['Key', c.keyLabel ?? 'not named'], ['Request', c.requestId ?? '—'],
                    ['Tokens', tokens(c.inputTokens, c.outputTokens)], ['Estimated cost', usd(c.estimatedUsd)], ['Time', `${c.latencyMs} ms`], ['Outcome', `${c.status}${c.verdict ? ` · ${c.verdict}` : ''}${c.reasonCode ? ` · ${c.reasonCode}` : ''}`],
                    ...(c.processingId ? [['Processing', c.processingId]] : [])] as [string, string][]).map(([k, v]) => <div key={k} className="contents"><dt className="text-[var(--muted)]">{k}</dt><dd className="min-w-0 break-all">{v}</dd></div>)}
            </dl>
        </details>;
    }
    const r = e.run, ai = r.documents.filter(d => d.method === 'AI_LAYOUT_PROPOSAL'), models = [...new Set(r.documents.flatMap(d => d.model ? [d.model] : []))];
    const accepted = r.documents.filter(d => d.decision === 'AUTO_ACCEPTED').length, aside = r.documents.length - accepted;
    // Layout checks exist only for documents the AI read; a server job also keeps each stage's decision.
    const checks = r.documents.reduce((s, d) => s + d.checks, 0), failed = r.documents.reduce((s, d) => s + d.failedChecks, 0);
    const stages = r.stages ?? [], verified = stages.filter(s => s.decision === 'AUTO_ACCEPTED').length, stageNote = stages.length ? ` · ${verified} of ${stages.length} stages verified` : '';
    async function open() {
        if (opened) return; setOpened(true);
        const res = await fetch(`/api/workspace/operations?run=${r.id}`, { cache: 'no-store' }).catch(() => null);
        if (res?.ok) setDetail(await res.json() as RunDetail);
    }
    const bad = aside > 0 || failed > 0 || verified < stages.length;
    return <details className="group" onToggle={ev => { if ((ev.currentTarget as HTMLDetailsElement).open) void open(); }}>
        <summary className="flex cursor-pointer gap-3 px-4 py-3.5 text-sm hover:bg-[var(--surface-subtle)] sm:px-5">
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${bad ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--good-soft)] text-[var(--good)]'}`}><FileText aria-hidden="true" size={16} /></span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold">{who(r.by)} processed {plural(r.documents.length, 'document')}{r.source === 'SERVER' ? ' on the server' : ' in the browser'}: {r.documents.length - ai.length} by fixed rules{ai.length ? `, ${ai.length} by AI (${models.join(', ')})` : ''}</span>
                <span className="block text-xs text-[var(--muted)]">{when(r.at)} · {accepted} accepted{aside ? `, ${aside} set aside` : ''}{stageNote}{checks ? ` · ${checks - failed} of ${checks} AI layout checks passed` : ''}{r.flagged ? ` · ${plural(r.flagged, 'item')} flagged` : ''}{r.durationMs !== null ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ''}{r.scope?.period ? ` · ${r.scope.businessId ?? ''} ${r.scope.period} ${r.scope.currency ?? ''}` : ''}</span>
            </span>
            <ChevronRight aria-hidden="true" size={16} className="disclosure-chevron mt-1 shrink-0 text-[var(--muted)] transition-transform" />
        </summary>
        <div className="space-y-3 px-4 pb-4 sm:px-5">
            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-[var(--border)]">
                <Table caption="Documents in this run" numeric={[4, 5]} columns={['Document', 'Read by', 'Decision', 'Checks', 'Tokens', 'Cost']} rows={r.documents.map(d => [
                    <span key="n" className="break-all">{d.name}<span className="block text-xs text-[var(--muted)]">{d.format} · {d.role?.replace('_', ' ').toLowerCase() ?? 'role not identified'}</span></span>,
                    <span key="m">{METHOD[d.method] ?? d.method}{d.model ? <span className="block text-xs text-[var(--muted)]">{d.model}{d.receiptMode === 'REPLAYED' ? ' (replayed, no new call)' : ''}</span> : null}</span>,
                    <span key="d" className={d.decision === 'AUTO_ACCEPTED' ? 'text-[var(--good-ink)]' : 'font-semibold text-[var(--warn-ink)]'}>{d.decision === 'AUTO_ACCEPTED' ? 'Accepted' : d.decision === 'QUARANTINED' ? 'Set aside' : 'Unavailable'}</span>,
                    d.checks ? `${d.checks - d.failedChecks} of ${d.checks}` : <span key="c" className="text-[var(--muted)]">{d.method === 'EXACT_SIGNATURE' ? 'Known layout' : '—'}</span>, tokens(d.inputTokens, d.outputTokens), usd(d.estimatedUsd)])} />
            </div>
            {stages.length ? <ol aria-label="Stages" className="grid gap-1.5 sm:grid-cols-2">{stages.map((s, i) => <li key={s.title} className="flex min-w-0 items-center gap-2 rounded-lg bg-[var(--surface-subtle)] px-3 py-1.5 text-xs ring-1 ring-inset ring-[var(--border)]">
                <span className="w-4 text-[var(--muted)] tabular-nums">{i + 1}</span><span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className={s.decision === 'AUTO_ACCEPTED' ? 'text-[var(--good-ink)]' : 'font-semibold text-[var(--warn-ink)]'}>{s.decision === 'AUTO_ACCEPTED' ? 'Verified' : s.failedChecks ? `${s.failedChecks} check${s.failedChecks === 1 ? '' : 's'} failed` : 'Set aside'}</span></li>)}</ol> : null}
            {e.calls.length ? <p className="text-xs text-[var(--muted-strong)]">AI calls in this job: {e.calls.map(c => `${featureLabel(c.feature)} ${STATUS[c.status]} (${c.model}, ${(c.latencyMs / 1000).toFixed(1)} s, ${usd(c.estimatedUsd)})`).join('; ')}.</p> : null}
            {detail ? detail.documents.map(d => {
                const failing = d.checks.filter(c => !c.passed);
                return <details key={d.ordinal} className="rounded-xl bg-[var(--surface-subtle)] p-3 text-xs ring-1 ring-inset ring-[var(--border)]">
                    <summary className="cursor-pointer font-semibold">{d.name}: {failing.length ? `${failing.length} check${failing.length === 1 ? '' : 's'} not passed` : d.checks.length ? `all ${d.checks.length} layout checks passed` : 'known layout, read by fixed rules'}</summary>
                    <p className="mt-2 text-[var(--muted-strong)]">{d.reason}</p>
                    <ul className="mt-2 space-y-1">{d.checks.map(c => <li key={c.id} className={c.passed ? '' : 'font-semibold text-[var(--warn-ink)]'}>{c.passed ? '✓' : '✗'} {c.label}: {c.detail}</li>)}{d.disclosures.map((x, i) => <li key={`d${i}`}>• {x}</li>)}{d.notes.map((x, i) => <li key={`n${i}`}>◦ {x}</li>)}</ul>
                    <p className="mt-2 text-[var(--muted)]">Processing {r.processingId} · {r.pipelineVersion}{d.model_request_id ? ` · request ${d.model_request_id}` : ''}</p>
                </details>;
            }) : opened ? <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle aria-hidden="true" size={13} className="animate-spin" />Loading every check…</p> : null}
        </div>
    </details>;
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replaceAll('"', '""')}"` : /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
function exportCsv(data: Log) {
    const rows: unknown[][] = [['When', 'Kind', 'By', 'Feature', 'Provider', 'Model', 'Key', 'Status', 'Verdict', 'Reason', 'Input tokens', 'Output tokens', 'Estimated USD', 'Latency ms', 'Documents', 'Accepted', 'Set aside', 'Processing'],
        ...data.aiCalls.map(c => [c.at, 'AI call', c.by, c.feature, c.provider, c.model, c.keyLabel, c.status, c.verdict, c.reasonCode, c.inputTokens, c.outputTokens, c.estimatedUsd, c.latencyMs, '', '', '', c.processingId]),
        ...data.runs.map(r => [r.at, r.source === 'SERVER' ? 'Server run' : 'Browser run', r.by, '', '', [...new Set(r.documents.flatMap(d => d.model ? [d.model] : []))].join(' '), '', r.outcome, '', '', '', '', '', r.durationMs, r.documents.length, r.documents.filter(d => d.decision === 'AUTO_ACCEPTED').length, r.documents.filter(d => d.decision !== 'AUTO_ACCEPTED').length, r.processingId]),
        ...data.failedJobs.map(j => [j.at, 'Stopped job', j.by, '', '', '', '', 'FAILED', '', j.error, '', '', '', '', j.documents, '', '', ''])];
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `fingence-technical-log-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
