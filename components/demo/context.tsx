'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserDemoRunner, type DocumentInput, type ProcessingContext, type Stage } from '@/lib/demo/pipeline';
import { gatewayInterpreter, gatewayStatus, replayInterpreter, type GatewayStatus } from '@/lib/interpretation/client';
import type { InterpretationResult } from '@/lib/interpretation/contracts';

/**
 * Browser processing context for the demo. Only the input documents (and, for unfamiliar layouts, the
 * model's layout proposals) are kept, per tab, in sessionStorage; every result is recomputed
 * deterministically from them, so a page can never show results from documents other than the current
 * ones. A reload replays stored proposals through the gates instead of calling the model again.
 */
const STORAGE_KEY = 'fingence-demo-documents-v1';
type Stored = { processedAt: string; documents: { name: string; provenance: DocumentInput['provenance']; base64: string }[]; interpretations?: Record<string, InterpretationResult> };
export type DemoStatus = 'loading' | 'empty' | 'processing' | 'ready' | 'failed';
type Value = {
    enabled: boolean; status: DemoStatus; context: ProcessingContext | null; liveStages: Stage[]; processedAt: string | null; persisted: boolean; error: string | null;
    process: (inputs: DocumentInput[]) => Promise<ProcessingContext | null>; clear: () => void;
    /** The AI layout gateway, when the server has it enabled; null while unknown. */
    ai: GatewayStatus | null;
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
    const [ai, setAi] = useState<GatewayStatus | null>(null);
    const run = useRef(0);
    useEffect(() => { if (enabled) void gatewayStatus().then(setAi); }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        const stored = readStored(), current = ++run.current;
        if (!stored) { queueMicrotask(() => { if (current === run.current) setStatus('empty'); }); return; }
        browserDemoRunner.run(stored.documents.map(d => ({ name: d.name, provenance: d.provenance, bytes: fromBase64(d.base64) })), undefined, { interpreter: replayInterpreter(stored.interpretations ?? {}, null) })
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
            }, { interpreter: ai?.available ? gatewayInterpreter : null });
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
    const value = useMemo(() => ({ enabled, status: enabled ? status : 'empty' as const, context: enabled ? context : null, liveStages, processedAt, persisted, error, process, clear, ai: enabled ? ai : null }), [enabled, status, context, liveStages, processedAt, persisted, error, process, clear, ai]);
    return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoProcessing() {
    const value = useContext(DemoContext);
    if (!value) throw Error('useDemoProcessing outside DemoProcessingProvider');
    return value;
}
