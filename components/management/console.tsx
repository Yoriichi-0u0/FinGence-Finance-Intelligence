'use client';
import { useCallback, useEffect, useState } from 'react';
import { CirclePause, CirclePlay, LoaderCircle, RefreshCw } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, primaryButton, Stat, Table, money, periodLabel } from '@/components/demo/shared';
import type { FlaggedItem, StageSummary } from '@/lib/processing/job-result';

type Scope = { businessId: string; businessName: string; period: string; currency: string } | null;
type JobRow = { id: string; createdAt: string; startedAt: string | null; finishedAt: string | null; status: string; documents: number; processingId: string | null; outcome: string | null; scope: Scope; summary: string | null; flaggedCount: number; ingestionRunId: string | null; error: string | null; stage: string | null };
type Flag = FlaggedItem & { ordinal: number; jobId: string; createdAt: string; scope: Scope };
type Overview = { processing: { paused: boolean; reason: string | null; changedAt: string | null }; counts: { jobs: number; running: number; failed: number }; jobs: JobRow[]; flagged: Flag[] };
type DocumentRow = { name: string; sha256: string; role: string | null; decision: string; reason: string; method: string; model: string | null; failedChecks: string[] };
type Detail = JobRow & { inputs: { name: string; sha256: string; bytes: number }[]; stages: StageSummary[]; results: { documents: DocumentRow[] } | null; flagged: (FlaggedItem & { ordinal: number })[] };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
const seconds = (a: string | null, b: string | null) => a && b ? `${((Date.parse(b) - Date.parse(a)) / 1000).toFixed(1)} s` : '—';
const KIND: Record<string, string> = { DOCUMENT: 'Document', RECONCILIATION_EXCEPTION: 'Reconciliation', ANOMALY_CANDIDATE: 'Anomaly', HISTORY: 'Bank history' };
const STATUS: Record<string, string> = { COMPLETED: 'text-emerald-800 bg-emerald-50', RUNNING: 'text-sky-900 bg-sky-50', QUEUED: 'text-slate-700 bg-slate-100', FAILED: 'text-red-800 bg-red-50' };
const badge = (status: string, label = status) => <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[status] ?? 'text-amber-900 bg-amber-50'}`}>{label}</span>;
const scopeText = (s: Scope) => s ? `${s.businessId} · ${periodLabel(s.period)} · ${s.currency}` : '—';

/** Management (Technical): every server processing job, the items FinGence flagged, and the switch that pauses processing. */
export function ManagementConsole() {
    const [data, setData] = useState<Overview | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
    const [detail, setDetail] = useState<Detail | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        const res = await fetch('/api/management', { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as (Overview & { code?: string }) | null;
        if (!res?.ok || !body?.processing) { setError(`Management could not be loaded (${body?.code ?? res?.status ?? 'unreachable'}).`); return; }
        setData(body); setError(null);
    }, []);
    useEffect(() => {
        queueMicrotask(() => void load());
        const timer = setInterval(() => void load(), 5_000);
        return () => clearInterval(timer);
    }, [load]);
    async function open(id: string) {
        const res = await fetch(`/api/management?job=${id}`, { cache: 'no-store' }).catch(() => null);
        setDetail(res?.ok ? await res.json() as Detail : null);
        setTimeout(() => document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }
    async function setPaused(paused: boolean) {
        setBusy(true); setNotice(null);
        const res = await fetch('/api/management', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(paused ? { action: 'pause', reason } : { action: 'resume' }) }).catch(() => null);
        const body = await res?.json().catch(() => null) as { code?: string } | null;
        setBusy(false);
        setNotice(res?.ok ? paused ? 'Processing paused. Finance users see the reason and cannot start new processing.' : 'Processing resumed.' : `Not done (${body?.code ?? 'unreachable'}).`);
        if (res?.ok) setReason('');
        await load();
    }
    const p = data?.processing;

    return <>
        <PageHeader title="Management" description="For your technical team: every server processing job, the items FinGence could not resolve, and the switch that pauses processing." actions={<button type="button" className={button} onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Refresh</button>} />
        <p role="note" className="mb-5 rounded-lg border border-amber-200 bg-[var(--amber-soft)] p-3 text-sm">FinGence processes every document on its own; nothing here waits for approval. Flagged items are what its rules could not settle, for you to investigate. This console has no sign-in yet and is only switched on locally (or where the owner opened it) until the workspace roles are turned on.</p>
        {error ? <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {data && p ? <div className="space-y-5">
            <Panel title="Processing" eyebrow={p.paused ? 'Paused' : 'Running'}>
                <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-2 text-sm">
                        <p className="flex items-center gap-2 text-base font-semibold">{p.paused ? <CirclePause aria-hidden="true" className="text-amber-700" size={20} /> : <CirclePlay aria-hidden="true" className="text-[var(--green)]" size={20} />}{p.paused ? 'Processing is paused' : 'Processing is on'}</p>
                        <p className="text-[var(--muted-strong)]">{p.paused ? <>Since {when(p.changedAt)}. Reason shown to Finance users: <strong>{p.reason}</strong></> : p.changedAt ? `Last resumed ${when(p.changedAt)}.` : 'Never paused.'} New jobs are {p.paused ? 'refused' : 'accepted'}; a job already running finishes.</p>
                    </div>
                    {p.paused
                        ? <div className="flex items-start"><button type="button" className={primaryButton} disabled={busy} onClick={() => void setPaused(false)}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <CirclePlay aria-hidden="true" size={16} />}Resume processing</button></div>
                        : <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); void setPaused(true); }}>
                            <label className="min-w-0 flex-1 text-sm"><span className="sr-only">Reason for pausing</span><input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} required placeholder="Reason (Finance users see it)" className="min-h-11 w-full rounded-lg border border-[var(--border-strong)] px-3" /></label>
                            <button type="submit" className={button} disabled={busy || !reason.trim()}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <CirclePause aria-hidden="true" size={16} />}Pause processing</button>
                        </form>}
                </div>
                {notice ? <p role="status" className="border-t border-[var(--border)] px-4 py-2 text-sm sm:px-5">{notice}</p> : null}
            </Panel>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Jobs" value={String(data.counts.jobs)} detail="All server processing jobs" />
                <Stat label="Running now" value={String(data.counts.running)} />
                <Stat label="Failed" value={String(data.counts.failed)} detail="Stopped before storing a result" />
                <Stat label="Flagged items" value={String(data.flagged.length)} detail="Latest run of each processing" />
            </div>
            <Panel title="Flagged items" eyebrow="Needs investigation">
                {data.flagged.length ? <Table caption="Flagged items" columns={['What', 'Kind', 'Amount', 'Business and period', 'Why', 'Job']} rows={data.flagged.map(f => [
                    <span key="t" className="grid gap-0.5"><span>{f.title}</span><code className="text-xs text-[var(--muted)]">{f.reference}</code></span>,
                    KIND[f.kind] ?? f.kind,
                    f.signedAmount && f.currency ? money(f.currency, Number(f.signedAmount).toFixed(2)) : '—',
                    <span key="s" className="text-xs">{scopeText(f.scope)}{f.date ? ` · ${f.date}` : ''}</span>,
                    <span key="r" className="text-xs text-[var(--muted-strong)]">{f.reason}</span>,
                    <button key="j" type="button" className="text-left text-xs font-semibold text-[var(--teal-dark)] underline" onClick={() => void open(f.jobId)}>{f.jobId.slice(0, 8)}</button>,
                ])} /> : <p className="p-5 text-sm">Nothing is flagged: every reconciliation exception and anomaly in the latest runs was resolved by a stated rule.</p>}
            </Panel>
            <Panel title="Processing jobs" eyebrow={`${data.jobs.length} most recent`}>
                {data.jobs.length ? <Table caption="Processing jobs" columns={['Job', 'Status', 'Started', 'Time', 'Documents', 'Business and period', 'Result']} rows={data.jobs.map(j => [
                    <button key="i" type="button" className="text-left font-mono text-xs font-semibold text-[var(--teal-dark)] underline" onClick={() => void open(j.id)}>{j.id.slice(0, 8)}</button>,
                    <span key="s" className="grid gap-1">{badge(j.status)}{j.status === 'RUNNING' && j.stage ? <span className="text-xs text-[var(--muted)]">after {j.stage.toLowerCase()}</span> : null}</span>,
                    <span key="c" className="text-xs">{when(j.createdAt)}</span>, seconds(j.startedAt, j.finishedAt), j.documents,
                    <span key="b" className="text-xs">{scopeText(j.scope)}</span>,
                    <span key="r" className="text-xs">{j.error ? <span className="text-red-800">Failed: {j.error}</span> : j.summary ?? '—'}{j.outcome ? <span className="mt-0.5 block text-[var(--muted)]">{j.outcome}{j.flaggedCount ? ` · ${j.flaggedCount} flagged` : ''}</span> : null}</span>,
                ])} /> : <p className="p-5 text-sm">No jobs yet. Process documents on the Data page.</p>}
            </Panel>
            {detail ? <div id="job-detail" className="scroll-mt-20"><Panel title={`Job ${detail.id}`} eyebrow={detail.status} action={<button type="button" className={button} onClick={() => setDetail(null)}>Close</button>}>
                <div className="space-y-4 p-4 text-sm sm:p-5">
                    <p className="text-[var(--muted-strong)]">Created {when(detail.createdAt)} · ran {seconds(detail.startedAt, detail.finishedAt)} · processing ID <code>{detail.processingId ?? '—'}</code> · ingestion run <code>{detail.ingestionRunId ?? '—'}</code>{detail.error ? <> · <span className="text-red-800">failed: {detail.error}</span></> : null}</p>
                    <div><h3 className="mb-1 font-semibold">Stages</h3>
                        <ol className="space-y-1">{detail.stages.map(s => <li key={s.id}><span className="mr-2">{badge(s.decision === 'AUTO_ACCEPTED' ? 'COMPLETED' : s.decision === 'QUARANTINED' ? 'QUARANTINED' : 'QUEUED', s.decision)}</span><strong>{s.title}.</strong> {s.summary}{s.failedChecks.length ? <ul className="ml-5 list-disc text-xs text-amber-900">{s.failedChecks.map(k => <li key={k.id}>{k.label}: {k.detail}</li>)}</ul> : null}</li>)}</ol>
                    </div>
                    <div><h3 className="mb-1 font-semibold">Documents</h3>
                        <Table caption="Job documents" columns={['Document', 'Decision', 'Read by', 'SHA-256']} rows={(detail.results?.documents ?? detail.inputs.map(i => ({ name: i.name, sha256: i.sha256, role: null, decision: '—', reason: `${i.bytes} bytes`, method: '—', model: null, failedChecks: [] }))).map(d => [
                            <span key="n" className="break-all">{d.name}</span>,
                            <span key="d" className="grid gap-0.5 text-xs"><strong>{d.decision}</strong><span className="text-[var(--muted)]">{d.reason}</span>{d.failedChecks.map(k => <span key={k} className="text-amber-900">{k}</span>)}</span>,
                            <span key="m" className="text-xs">{d.method === 'AI_LAYOUT_PROPOSAL' ? `AI layout proposal (${d.model}), gated` : d.method === 'EXACT_SIGNATURE' ? 'Schema signature' : d.method}</span>,
                            <code key="s" className="text-xs">{d.sha256.slice(0, 16)}…</code>,
                        ])} />
                    </div>
                    {detail.flagged.length ? <div><h3 className="mb-1 font-semibold">Flagged in this job</h3><ul className="list-disc space-y-1 pl-5">{detail.flagged.map(f => <li key={f.ordinal}><strong>{KIND[f.kind] ?? f.kind}:</strong> {f.title} <span className="text-xs text-[var(--muted)]">{f.reason}</span></li>)}</ul></div> : null}
                </div>
            </Panel></div> : null}
        </div> : !error ? <p className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin" size={16} />Loading…</p> : null}
    </>;
}
