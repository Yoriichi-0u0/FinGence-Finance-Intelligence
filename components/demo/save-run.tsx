'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, LoaderCircle } from 'lucide-react';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { runPayload } from '@/lib/document-ingestion/run-payload';
import { plainMessage, useWorkspace } from '@/components/workspace/context';
import { button } from './shared';

const RECORDED = 'fingence-recorded-runs-v1';
const recorded = (): string[] => { try { return JSON.parse(sessionStorage.getItem(RECORDED) ?? '[]') as string[]; } catch { return []; } };
const remember = (id: string) => { try { sessionStorage.setItem(RECORDED, JSON.stringify([...recorded(), id].slice(-50))); } catch { /* best effort */ } };

type State = { processingId: string; status: 'saving' | 'saved' | 'failed'; detail: string };
async function send(context: ProcessingContext): Promise<{ ok: true; runId: string } | { ok: false; code: string }> {
    try {
        const res = await fetch('/api/ingestion/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runPayload(context)) });
        const body = await res.json().catch(() => null) as { runId?: string; code?: string } | null;
        return res.ok && body?.runId ? { ok: true, runId: body.runId } : { ok: false, code: body?.code ?? `HTTP ${res.status}` };
    } catch { return { ok: false, code: 'unreachable' }; }
}

/**
 * Keeps a record of the completed run (fingerprints, decisions, receipts, checks and verified records; never the files).
 * - Signed in as Finance: recorded automatically for the organization, no click, so Management sees every run.
 * - Workspace on but not signed in (public demo): not recorded.
 * - No workspace: the earlier optional save button.
 */
export function SaveRun({ context }: { context: ProcessingContext }) {
    const workspace = useWorkspace();
    const [store, setStore] = useState<{ stores: string } | null>(null);
    const [state, setState] = useState<State | null>(null);
    const started = useRef<string | null>(null);
    useEffect(() => { let live = true; fetch('/api/ingestion/runs', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { if (live && b?.available) setStore({ stores: String(b.stores ?? '') }); }).catch(() => undefined); return () => { live = false; }; }, []);
    const automatic = workspace.enabled && workspace.session?.role === 'FINANCE';
    async function save() {
        started.current = context.processingId;
        setState({ processingId: context.processingId, status: 'saving', detail: '' });
        const result = await send(context);
        if (result.ok) remember(context.processingId);
        setState({ processingId: context.processingId, status: result.ok ? 'saved' : 'failed', detail: result.ok ? result.runId : result.code });
        if (!result.ok && (result.code === 'SESSION_ENDED' || result.code === 'SIGN_IN_REQUIRED' || result.code === 'PROCESSING_PAUSED')) void workspace.refresh();
    }
    useEffect(() => {
        // Each processing is recorded once: a reload replays the same processing ID, which this tab has already recorded.
        if (!automatic || !store || started.current === context.processingId) return;
        if (recorded().includes(context.processingId)) { started.current = context.processingId; queueMicrotask(() => setState({ processingId: context.processingId, status: 'saved', detail: '' })); return; }
        queueMicrotask(() => void save());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automatic, store, context.processingId]);
    if (!store || (workspace.enabled && !automatic)) return null;
    const current = state?.processingId === context.processingId ? state : null;
    if (automatic) return <div role="status" className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        {current?.status === 'saved' ? <CheckCircle2 aria-hidden="true" size={16} className="text-[var(--teal)]" /> : current?.status === 'failed' ? <Database aria-hidden="true" size={16} /> : <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />}
        <span>{current?.status === 'saved' ? `Recorded for ${workspace.session!.organization.name}.` : current?.status === 'failed' ? `Not recorded. ${plainMessage(current.detail)}` : `Recording this run for ${workspace.session!.organization.name}…`}</span>
        {current?.status === 'failed' && current.detail !== 'PROCESSING_PAUSED' ? <button type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} onClick={() => void save()}>Try again</button> : null}
    </div>;
    return <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        <button type="button" className={button} disabled={current?.status === 'saving' || current?.status === 'saved'} onClick={() => void save()}>{current?.status === 'saving' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Database aria-hidden="true" size={16} />}{current?.status === 'saved' ? 'Saved' : 'Save verified records'}</button>
        <span role="status" className="text-xs text-[var(--muted)]">{current?.status === 'saved' ? `Stored as ingestion run ${current.detail}.` : current?.status === 'failed' ? `Not saved (${current.detail}).` : `Stores in the FinGence database: ${store.stores}`}</span>
    </div>;
}
