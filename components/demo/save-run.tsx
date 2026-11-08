'use client';
import { useEffect, useState } from 'react';
import { Database, LoaderCircle } from 'lucide-react';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { runPayload } from '@/lib/document-ingestion/run-payload';
import { button } from './shared';

/** Saves the completed run (fingerprints, decisions, receipts, checks and verified records; never the files) when the store is on. */
export function SaveRun({ context }: { context: ProcessingContext }) {
    const [store, setStore] = useState<{ stores: string } | null>(null);
    const [state, setState] = useState<{ processingId: string; status: 'saving' | 'saved' | 'failed'; detail: string } | null>(null);
    useEffect(() => { let live = true; fetch('/api/ingestion/runs', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { if (live && b?.available) setStore({ stores: String(b.stores ?? '') }); }).catch(() => undefined); return () => { live = false; }; }, []);
    if (!store) return null;
    const current = state?.processingId === context.processingId ? state : null;
    async function save() {
        setState({ processingId: context.processingId, status: 'saving', detail: '' });
        try {
            const res = await fetch('/api/ingestion/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runPayload(context)) });
            const body = await res.json().catch(() => null) as { runId?: string; code?: string } | null;
            setState({ processingId: context.processingId, status: res.ok && body?.runId ? 'saved' : 'failed', detail: res.ok && body?.runId ? body.runId : body?.code ?? `HTTP ${res.status}` });
        } catch { setState({ processingId: context.processingId, status: 'failed', detail: 'unreachable' }); }
    }
    return <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4 text-sm sm:px-5">
        <button type="button" className={button} disabled={current?.status === 'saving' || current?.status === 'saved'} onClick={() => void save()}>{current?.status === 'saving' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Database aria-hidden="true" size={16} />}{current?.status === 'saved' ? 'Saved' : 'Save verified records'}</button>
        <span role="status" className="text-xs text-[var(--muted)]">{current?.status === 'saved' ? `Stored as ingestion run ${current.detail}.` : current?.status === 'failed' ? `Not saved (${current.detail}).` : `Stores in the FinGence database: ${store.stores}`}</span>
    </div>;
}
