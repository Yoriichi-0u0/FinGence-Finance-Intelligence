'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserDemoRunner, type DocumentInput, type ProcessingContext, type Stage } from '@/lib/demo/pipeline';
import { gatewayInterpreter, gatewayStatus, type GatewayStatus } from '@/lib/interpretation/client';
import { readStored, writeStored, restoreStored, toBase64 } from '@/lib/demo/session';

/**
 * Browser processing context for the demo. Only the input documents (and, for unfamiliar layouts, the
 * model's layout proposals) are kept, per tab, in sessionStorage; every result is recomputed
 * deterministically from them, so a page can never show results from documents other than the current
 * ones. A reload replays stored proposals through the gates instead of calling the model again.
 */
export type DemoStatus = 'loading' | 'empty' | 'processing' | 'ready' | 'failed';
type Value = {
    enabled: boolean; status: DemoStatus; context: ProcessingContext | null; liveStages: Stage[]; processedAt: string | null; persisted: boolean; error: string | null;
    process: (inputs: DocumentInput[]) => Promise<ProcessingContext | null>; clear: () => void;
    /** The AI layout gateway, when the server has it enabled; null while unknown. */
    ai: GatewayStatus | null;
};
const DemoContext = createContext<Value | null>(null);

/** `aiGateway` is the server's own answer to "is the AI gateway enabled?": when it is false the browser never probes the (404) AI routes. */
export function DemoProcessingProvider({ enabled, aiGateway = false, children }: { enabled: boolean; aiGateway?: boolean; children: React.ReactNode }) {
    const [status, setStatus] = useState<DemoStatus>('loading');
    const [context, setContext] = useState<ProcessingContext | null>(null);
    const [liveStages, setLiveStages] = useState<Stage[]>([]);
    const [processedAt, setProcessedAt] = useState<string | null>(null);
    const [persisted, setPersisted] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [ai, setAi] = useState<GatewayStatus | null>(null);
    const run = useRef(0), probe = useRef<Promise<GatewayStatus> | null>(null);
    useEffect(() => { if (enabled && aiGateway) { probe.current = gatewayStatus(); void probe.current.then(setAi); } }, [enabled, aiGateway]);

    useEffect(() => {
        if (!enabled) return;
        const stored = readStored(), current = ++run.current;
        if (!stored) { queueMicrotask(() => { if (current === run.current) setStatus('empty'); }); return; }
        restoreStored(stored)
            .then(result => { if (current !== run.current) return; setContext(result); setLiveStages(result.stages); setProcessedAt(stored.processedAt); setStatus('ready'); })
            .catch(() => { if (current !== run.current) return; writeStored(null); setStatus('empty'); });
    }, [enabled]);

    const processDocuments = useCallback(async (inputs: DocumentInput[]) => {
        // Clear first: a failed or abandoned run can never leave the previous documents' results on screen.
        const current = ++run.current;
        writeStored(null); setContext(null); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('processing');
        try {
            // If the server says AI is on but the browser's status check has not answered yet (a fast click after a
            // fresh load), wait for it, so an unfamiliar document is never processed without the interpreter by accident.
            const status = ai ?? (probe.current ? await probe.current : null);
            const result = await browserDemoRunner.run(inputs, async stage => {
                if (current !== run.current) return;
                setLiveStages(stages => [...stages, stage]);
                await new Promise(resolve => setTimeout(resolve, 0));
            }, { interpreter: status?.available ? gatewayInterpreter : null });
            if (current !== run.current) return null;
            const at = new Date().toISOString();
            const interpretations = Object.fromEntries(result.documents.flatMap(d => d.interpretation?.receipt ? [[d.sha256, { proposal: d.interpretation.proposal, receipt: d.interpretation.receipt }]] : []));
            setPersisted(writeStored({ processedAt: at, documents: inputs.map(d => ({ name: d.name, provenance: d.provenance, base64: toBase64(d.bytes) })), interpretations }));
            setContext(result); setProcessedAt(at); setStatus('ready');
            return result;
        } catch {
            if (current === run.current) { setError('Processing stopped unexpectedly. No result was kept.'); setStatus('failed'); }
            return null;
        }
    }, [ai]);
    const clear = useCallback(() => { run.current++; writeStored(null); setContext(null); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('empty'); }, []);
    const value = useMemo(() => ({ enabled, status: enabled ? status : 'empty' as const, context: enabled ? context : null, liveStages, processedAt, persisted, error, process: processDocuments, clear, ai: enabled ? ai : null }), [enabled, status, context, liveStages, processedAt, persisted, error, processDocuments, clear, ai]);
    return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoProcessing() {
    const value = useContext(DemoContext);
    if (!value) throw Error('useDemoProcessing outside DemoProcessingProvider');
    return value;
}
