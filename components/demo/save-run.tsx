'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, LoaderCircle } from 'lucide-react';
import type { DocumentInput, ProcessingContext } from '@/lib/demo/pipeline';
import { interpretationsOf } from '@/lib/document-ingestion/ingest';
import { savedRunPayload } from '@/lib/history/saved-run';
import { useDemoProcessing } from './context';
import { runPayload } from '@/lib/document-ingestion/run-payload';
import { plainMessage, useWorkspace } from '@/components/workspace/context';
import { button } from './shared';

const RECORDED = 'fingence-recorded-runs-v1';
const recorded = (): string[] => { try { return JSON.parse(sessionStorage.getItem(RECORDED) ?? '[]') as string[]; } catch { return []; } };
const remember = (id: string) => { try { sessionStorage.setItem(RECORDED, JSON.stringify([...recorded(), id].slice(-50))); } catch { /* best effort */ } };
// Saved to History, tracked apart from the run record: a History save that failed is retried (here, or on the next visit).
const IN_HISTORY = 'fingence-history-saved-v1';
const inHistory = (): string[] => { try { return JSON.parse(sessionStorage.getItem(IN_HISTORY) ?? '[]') as string[]; } catch { return []; } };
const rememberHistory = (id: string) => { try { sessionStorage.setItem(IN_HISTORY, JSON.stringify([...inHistory(), id].slice(-50))); } catch { /* best effort */ } };

type State = { processingId: string; status: 'saving' | 'saved' | 'failed'; detail: string };
async function send(context: ProcessingContext): Promise<{ ok: true; runId: string } | { ok: false; code: string }> {
    try {
        const res = await fetch('/api/ingestion/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runPayload(context)) });
        const body = await res.json().catch(() => null) as { runId?: string; code?: string } | null;
        return res.ok && body?.runId ? { ok: true, runId: body.runId } : { ok: false, code: body?.code ?? `HTTP ${res.status}` };
    } catch { return { ok: false, code: 'unreachable' }; }
}

/** Save a run processed in this browser to the person's History: its description and its documents (server jobs save themselves). */
async function sendToHistory(context: ProcessingContext, inputs: DocumentInput[], processedAt: string): Promise<boolean> {
    try {
        const payload = await savedRunPayload(context, inputs, { interpretations: interpretationsOf(context.documents) }, processedAt);
        const form = new FormData();
        form.set('run', JSON.stringify(payload));
        for (const d of inputs) form.append('file', new Blob([d.bytes.slice()]), d.name);
        return (await fetch('/api/workspace/history', { method: 'POST', body: form })).ok;
    } catch { return false; }
}

/**
 * Keeps a record of the completed run (fingerprints, decisions, receipts, checks and verified records; never the files).
 * - Signed in (any role, SAIC only): recorded automatically for the organization, no click, so Admins see every run in Operations.
 * - Workspace on but not signed in: not recorded (the page sends the person to sign in).
 * - No workspace: the earlier optional save button.
 */
export function SaveRun({ context }: { context: ProcessingContext }) {
    const workspace = useWorkspace(), { inputs, processedAt, savedRun } = useDemoProcessing();
    const [history, setHistory] = useState<boolean | null>(null);
    const [store, setStore] = useState<{ stores: string } | null>(null);
    const [state, setState] = useState<State | null>(null);
    const started = useRef<string | null>(null);
    useEffect(() => { let live = true; fetch('/api/ingestion/runs', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { if (live && b?.available) setStore({ stores: String(b.stores ?? '') }); }).catch(() => undefined); return () => { live = false; }; }, []);
    const automatic = workspace.enabled && !!workspace.session;
    // Signed in: the run also goes to the person's History, with its documents (not for a run reopened from History).
    async function saveHistory() {
        if (!automatic || savedRun || !inputs.length || inHistory().includes(context.processingId)) { if (inHistory().includes(context.processingId)) setHistory(true); return; }
        setHistory(null);
        const ok = await sendToHistory(context, inputs, processedAt ?? new Date().toISOString());
        if (ok) rememberHistory(context.processingId);
        setHistory(ok);
    }
    async function save() {
        started.current = context.processingId;
        setState({ processingId: context.processingId, status: 'saving', detail: '' });
        const result = await send(context);
        if (result.ok) remember(context.processingId);
        // Signed in: the run also goes to the person's History, with its documents (not again for a run reopened from History).
        if (result.ok) await saveHistory();
        setState({ processingId: context.processingId, status: result.ok ? 'saved' : 'failed', detail: result.ok ? result.runId : result.code });
        if (!result.ok && (result.code === 'SESSION_ENDED' || result.code === 'SIGN_IN_REQUIRED' || result.code === 'PROCESSING_PAUSED')) void workspace.refresh();
    }
    useEffect(() => {
        // Each processing is recorded once: a reload replays the same processing ID, which this tab has already recorded.
        if (!automatic || !store || started.current === context.processingId) return;
        // Already recorded (e.g. after a reload): only the History save may still be owed.
        if (recorded().includes(context.processingId)) { started.current = context.processingId; queueMicrotask(() => { setState({ processingId: context.processingId, status: 'saved', detail: '' }); void saveHistory(); }); return; }
        queueMicrotask(() => void save());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automatic, store, context.processingId]);
    if (!store || (workspace.enabled && !automatic)) return null;
    const current = state?.processingId === context.processingId ? state : null;
    if (automatic) return <div role="status" className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        {current?.status === 'saved' ? <CheckCircle2 aria-hidden="true" size={16} className="text-[var(--teal)]" /> : current?.status === 'failed' ? <Database aria-hidden="true" size={16} /> : <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
        <span>{current?.status === 'saved' ? `Recorded for ${workspace.session!.organization.name}.${history === true ? ' Saved to your History.' : history === false ? ' Not saved to your History.' : ''}` : current?.status === 'failed' ? `Not recorded. ${plainMessage(current.detail)}` : `Recording this run for ${workspace.session!.organization.name}…`}</span>
        {current?.status === 'failed' && current.detail !== 'PROCESSING_PAUSED' ? <button type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} onClick={() => void save()}>Try again</button> : null}
        {current?.status === 'saved' && history === false ? <button type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} onClick={() => void saveHistory()}>Save to History again</button> : null}
    </div>;
    return <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        <button type="button" className={button} disabled={current?.status === 'saving' || current?.status === 'saved'} onClick={() => void save()}>{current?.status === 'saving' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Database aria-hidden="true" size={16} />}{current?.status === 'saved' ? 'Saved' : 'Save verified records'}</button>
        <span role="status" className="text-xs text-[var(--muted)]">{current?.status === 'saved' ? `Stored as ingestion run ${current.detail}.` : current?.status === 'failed' ? `Not saved (${current.detail}).` : `Stores in the FinGence database: ${store.stores}`}</span>
    </div>;
}

/** A run processed on the server saves itself to History; this confirms it (a few tries, as the save follows the job). */
export function SavedToHistory({ processingId }: { processingId: string }) {
    const workspace = useWorkspace(), { savedRun } = useDemoProcessing();
    const [state, setState] = useState<'checking' | 'saved' | 'missing'>('checking');
    useEffect(() => {
        if (!workspace.session || savedRun) return;
        let live = true, tries = 0;
        const check = async () => {
            const res = await fetch('/api/workspace/history?scope=mine', { cache: 'no-store' }).catch(() => null);
            const body = await res?.json().catch(() => null) as { runs?: { processingId: string }[] } | null;
            if (!live) return;
            if (body?.runs?.some(r => r.processingId === processingId)) { setState('saved'); return; }
            if (++tries < 5) setTimeout(() => void check(), 2_000); else setState('missing');
        };
        void check();
        return () => { live = false; };
    }, [workspace.session, savedRun, processingId]);
    if (!workspace.session || savedRun) return null;
    return <div role="status" className="flex items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        {state === 'saved' ? <CheckCircle2 aria-hidden="true" size={16} className="text-[var(--good)]" /> : state === 'missing' ? <Database aria-hidden="true" size={16} /> : <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
        <span>{state === 'saved' ? <>Saved to your <a href="/history" className="font-semibold text-[var(--brand-ink)] underline underline-offset-2">History</a>, with its documents.</> : state === 'missing' ? 'Not found in your History yet. Refresh History in a moment.' : 'Saving to your History…'}</span>
    </div>;
}
