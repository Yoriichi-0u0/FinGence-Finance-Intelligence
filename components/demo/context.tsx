'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserDemoRunner, type DocumentInput, type ProcessingContext, type Stage } from '@/lib/demo/pipeline';

/**
 * Browser-only processing context for the synthetic demo. Only the input documents are kept, per
 * tab, in sessionStorage; every result is recomputed deterministically from them, so a page can
 * never show results from documents other than the current ones. Nothing leaves the browser.
 */
const STORAGE_KEY = 'fingence-demo-documents-v1';
type Stored = { processedAt: string; documents: { name: string; provenance: DocumentInput['provenance']; base64: string }[] };
export type DemoStatus = 'loading' | 'empty' | 'processing' | 'ready' | 'failed';
type Value = {
    enabled: boolean; status: DemoStatus; context: ProcessingContext | null; liveStages: Stage[]; processedAt: string | null; persisted: boolean; error: string | null;
    process: (inputs: DocumentInput[]) => Promise<ProcessingContext | null>; clear: () => void;
};
const DemoContext = createContext<Value | null>(null);

const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
function readStored(): Stored | null {
    try { const raw = sessionStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Stored : null; } catch { return null; }
}
function writeStored(value: Stored | null) {
    try { if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else sessionStorage.removeItem(STORAGE_KEY); return true; } catch { return false; }
}

export function DemoProcessingProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
    const [status, setStatus] = useState<DemoStatus>('loading');
    const [context, setContext] = useState<ProcessingContext | null>(null);
    const [liveStages, setLiveStages] = useState<Stage[]>([]);
    const [processedAt, setProcessedAt] = useState<string | null>(null);
    const [persisted, setPersisted] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const run = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        const stored = readStored(), current = ++run.current;
        if (!stored) { queueMicrotask(() => { if (current === run.current) setStatus('empty'); }); return; }
        browserDemoRunner.run(stored.documents.map(d => ({ name: d.name, provenance: d.provenance, bytes: fromBase64(d.base64) })))
            .then(result => { if (current !== run.current) return; setContext(result); setLiveStages(result.stages); setProcessedAt(stored.processedAt); setStatus('ready'); })
            .catch(() => { if (current !== run.current) return; writeStored(null); setStatus('empty'); });
    }, [enabled]);

    const process = useCallback(async (inputs: DocumentInput[]) => {
        // Clear first: a failed or abandoned run can never leave the previous documents' results on screen.
        const current = ++run.current;
        writeStored(null); setContext(null); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('processing');
        try {
            const result = await browserDemoRunner.run(inputs, async stage => {
                if (current !== run.current) return;
                setLiveStages(stages => [...stages, stage]);
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            if (current !== run.current) return null;
            const at = new Date().toISOString();
            setPersisted(writeStored({ processedAt: at, documents: inputs.map(d => ({ name: d.name, provenance: d.provenance, base64: toBase64(d.bytes) })) }));
            setContext(result); setProcessedAt(at); setStatus('ready');
            return result;
        } catch {
            if (current === run.current) { setError('Processing stopped unexpectedly. No result was kept.'); setStatus('failed'); }
            return null;
        }
    }, []);
    const clear = useCallback(() => { run.current++; writeStored(null); setContext(null); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('empty'); }, []);
    const value = useMemo(() => ({ enabled, status: enabled ? status : 'empty' as const, context: enabled ? context : null, liveStages, processedAt, persisted, error, process, clear }), [enabled, status, context, liveStages, processedAt, persisted, error, process, clear]);
    return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoProcessing() {
    const value = useContext(DemoContext);
    if (!value) throw Error('useDemoProcessing outside DemoProcessingProvider');
    return value;
}
