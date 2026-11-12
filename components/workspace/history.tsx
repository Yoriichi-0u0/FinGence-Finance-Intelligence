'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FileDown, FolderOpen, HardDrive, History as HistoryIcon, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, chip, primaryButton } from '@/components/demo/shared';
import { useDemoProcessing } from '@/components/demo/context';
import type { DocumentInput } from '@/lib/demo/pipeline';
import type { RestoreBundle } from '@/lib/history/saved-run';
import { atLeast, plainMessage, useWorkspace } from './context';

type Confidence = { status: 'MEASURED' | 'INCOMPLETE'; percent?: number; band?: 'HIGH' | 'CHECK' | 'LOW'; reason?: string };
type Run = { id: string; at: string; by: string | null; mine: boolean; processingId: string; status: string; businessId: string | null; businessName: string | null; period: string | null; currency: string | null;
    documents: { name: string; bytes: number; stored: boolean }[]; confidence: Confidence; filesKept: boolean };
type Usage = { filesBytes: number; rowsBytes: number; runs: number; filesCap: number; rowsCap: number };
type Listing = { scope: 'mine' | 'all'; runs: Run[]; usage: Usage };

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const periodLabel = (p: string | null) => { if (!p) return 'Period not identified'; const [a, b] = p.split('/'); return b ? `${monthName(a)} to ${monthName(b)}` : monthName(a); };
const BAND: Record<string, string> = { HIGH: 'bg-[var(--good-soft)] text-[var(--good-ink)] ring-[var(--good-line)]', CHECK: 'bg-[var(--warn-soft)] text-[var(--warn-ink)] ring-[var(--warn-line)]', LOW: 'bg-[var(--bad-soft)] text-[var(--bad-ink)] ring-[var(--bad-line)]' };

/**
 * History: every run a person processed, saved with its documents until they delete it. Opening one brings its results back
 * into every page (recomputed from the saved documents, exactly as when it ran). Admins and Superadmins can also see
 * everyone's runs in the organization.
 */
export function HistoryPage() {
    const workspace = useWorkspace(), demo = useDemoProcessing(), router = useRouter();
    const admin = atLeast(workspace.viewRole ?? undefined, 'ADMIN');
    const [scope, setScope] = useState<'mine' | 'all'>('mine'), [data, setData] = useState<Listing | null>(null), [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null), [confirm, setConfirm] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
    const shown = admin ? scope : 'mine';
    const load = useCallback(async (which: 'mine' | 'all') => {
        const res = await fetch(`/api/workspace/history?scope=${which}`, { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as Listing & { code?: string } | null;
        if (!res?.ok || !body) { setError(plainMessage(body?.code)); return; }
        setData(body); setError(null);
    }, []);
    useEffect(() => { if (!workspace.loading) queueMicrotask(() => void load(shown)); }, [workspace.loading, load, shown]);

    async function open(run: Run, then: string) {
        setBusy(run.id); setNotice(null);
        try {
            const res = await fetch(`/api/workspace/history/${run.id}`, { cache: 'no-store' });
            const saved = await res.json() as { at: string; documents: { name: string; provenance: DocumentInput['provenance'] }[]; bundle: RestoreBundle; code?: string };
            if (!res.ok) throw Error(saved.code);
            const documents = await Promise.all(saved.documents.map(async (d, i) => {
                const file = await fetch(`/api/workspace/history/${run.id}/document/${i}`, { cache: 'no-store' });
                if (!file.ok) throw Error('FILE');
                return { name: d.name, provenance: d.provenance, bytes: new Uint8Array(await file.arrayBuffer()) };
            }));
            const opened = await demo.openSaved({ processedAt: saved.at, documents, bundle: saved.bundle }, { id: run.id, at: saved.at, by: run.mine ? null : run.by });
            if (!opened) { setNotice('This saved run could not be reproduced by this version of FinGence, so it is not shown.'); return; }
            router.push(then);
        } catch { setNotice('The saved run could not be opened. Please try again.'); }
        finally { setBusy(null); }
    }
    async function remove(run: Run) {
        setBusy(run.id); setNotice(null);
        const res = await fetch(`/api/workspace/history/${run.id}`, { method: 'DELETE' }).catch(() => null);
        setBusy(null); setConfirm(null);
        if (!res?.ok) { setNotice('The run could not be deleted. Please try again.'); return; }
        if (demo.savedRun?.id === run.id) demo.clear();
        setNotice('Deleted, with any document no other saved run uses.');
        await load(shown);
    }

    const usage = data?.usage, usedShare = usage ? usage.filesBytes / usage.filesCap : 0;
    return <>
        <PageHeader eyebrow="Workspace" title="History" description="Every run you processed, saved with its documents until you delete it. Open one to see all its results again."
            actions={<button type="button" className={button} onClick={() => void load(shown)}><RefreshCw aria-hidden="true" size={16} />Refresh</button>} />
        {admin ? <div role="group" aria-label="Whose runs" className="mb-4 flex flex-wrap gap-2">
            {([['mine', 'My runs'], ['all', `Everyone in ${workspace.session?.organization.name ?? 'the organization'}`]] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={shown === k} className={chip(shown === k)} onClick={() => setScope(k)}>{label}</button>)}
        </div> : null}
        {notice ? <p role="status" className="mb-4 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm ring-1 ring-inset ring-[var(--border)]">{notice}</p> : null}
        {error ? <Panel><p className="p-4 text-sm sm:p-5">{error}</p></Panel>
            : !data ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" size={16} className="animate-spin" />Loading…</p>
            : <>
                {data.runs.length ? <ol className="grid min-w-0 gap-3">{data.runs.map(run => <li key={run.id} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-panel)] sm:p-5">
                    <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-[var(--muted)]">{when(run.at)}{shown === 'all' ? ` · ${run.by ?? 'someone no longer a member'}` : ''}</p>
                            <p className="mt-0.5 font-semibold">{run.businessName ?? 'Documents set aside'} <span className="font-normal text-[var(--muted-strong)]">· {periodLabel(run.period)}{run.currency ? ` · ${run.currency}` : ''}</span></p>
                            <p className="mt-1 truncate text-xs text-[var(--muted)]" title={run.documents.map(d => d.name).join(', ')}>{run.documents.length} document{run.documents.length === 1 ? '' : 's'}: {run.documents.map(d => d.name).join(', ')}</p>
                            {run.filesKept ? null : <p className="mt-1 text-xs font-semibold text-[var(--warn-ink)]">Documents not kept (storage was full), so this run cannot be reopened.</p>}
                        </div>
                        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset ${run.confidence.status === 'MEASURED' ? BAND[run.confidence.band ?? 'LOW'] : 'bg-[var(--surface-subtle)] text-[var(--muted-strong)] ring-[var(--border)]'}`}>
                            {run.confidence.status === 'MEASURED' ? `${run.confidence.percent}% confidence` : 'Confidence incomplete'}
                        </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                        <button type="button" className={primaryButton} disabled={!run.filesKept || !!busy} onClick={() => void open(run, '/')}>{busy === run.id ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> : <FolderOpen aria-hidden="true" size={16} />}Open</button>
                        <button type="button" className={button} disabled={!run.filesKept || !!busy} onClick={() => void open(run, '/reports?print=1')}><FileDown aria-hidden="true" size={16} />Download report</button>
                        {run.mine || admin ? confirm === run.id
                            ? <span className="ml-auto flex items-center gap-2 text-xs"><span className="text-[var(--muted-strong)]">Delete this run{run.filesKept ? ' and its documents' : ''}?</span>
                                <button type="button" className={`${button} border-[var(--bad-line)] text-[var(--bad-ink)]`} disabled={!!busy} onClick={() => void remove(run)}><Trash2 aria-hidden="true" size={15} />Delete</button>
                                <button type="button" className={button} onClick={() => setConfirm(null)}>Keep</button></span>
                            : <button type="button" className={`${button} ml-auto`} disabled={!!busy} onClick={() => setConfirm(run.id)} aria-label={`Delete the run of ${when(run.at)}`}><Trash2 aria-hidden="true" size={15} />Delete</button> : null}
                    </div>
                </li>)}</ol>
                    : <Panel><p className="flex items-center gap-2.5 p-5 text-sm text-[var(--muted-strong)]"><HistoryIcon aria-hidden="true" size={18} className="text-[var(--muted)]" />No saved runs yet. Process documents on Data: each run is saved here automatically.</p></Panel>}
                {usage ? <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
                    <p className="flex flex-wrap items-center gap-2"><HardDrive aria-hidden="true" size={16} className="text-[var(--muted)]" /><span className="font-semibold">Saved documents for {workspace.session?.organization.name ?? 'the organization'}</span>
                        <span className="ml-auto text-xs text-[var(--muted)] tabular-nums">{mb(usage.filesBytes)} of {mb(usage.filesCap)} · {usage.runs} saved run{usage.runs === 1 ? '' : 's'}</span></p>
                    <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><span className={`block h-full rounded-full ${usedShare >= 0.8 ? 'bg-[var(--warn)]' : 'bg-[var(--brand)]'}`} style={{ width: `${Math.min(100, Math.max(usedShare * 100, usage.filesBytes ? 1 : 0))}%` }} /></div>
                    {usedShare >= 0.8 ? <p className="mt-2 text-xs font-semibold text-[var(--warn-ink)]">{admin ? 'Storage is over 80% full. Delete old runs to make room; once full, new runs keep their results but not their documents.' : 'Storage is nearly full. Ask your Admin to make room.'}</p>
                        : <p className="mt-2 text-xs text-[var(--muted)]">Documents are kept in private storage, once each, until every run that uses them is deleted.</p>}
                </div> : null}
            </>}
    </>;
}
