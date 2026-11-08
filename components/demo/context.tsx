'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserDemoRunner, type DocumentInput, type ProcessingContext, type Stage } from '@/lib/demo/pipeline';
import { createGatewayInterpreter, gatewayStatus, replayInterpreter, type GatewayStatus } from '@/lib/interpretation/client';
import type { InterpretationResult } from '@/lib/interpretation/contracts';
import { interpretationsOf } from '@/lib/document-ingestion/ingest';
import { replayExtractor, type StoredExtraction } from '@/lib/processing/extractions';
import { submitServerJob, type ServerProcessingState } from './server-jobs';

/**
 * Browser processing context for the demo. Only the input documents (and, for unfamiliar layouts, the
 * model's layout proposals) are kept, per tab, in sessionStorage; every result is recomputed
 * deterministically from them, so a page can never show results from documents other than the current
 * ones. A reload replays stored proposals through the gates instead of calling the model again.
 */
const STORAGE_KEY = 'fingence-demo-documents-v1';
type Stored = { processedAt: string; documents: { name: string; provenance: DocumentInput['provenance']; base64: string }[]; interpretations?: Record<string, InterpretationResult>; job?: { id: string; processingId: string }; extractions?: Record<string, StoredExtraction> };
export type DemoStatus = 'loading' | 'empty' | 'processing' | 'ready' | 'failed';
type Value = {
    enabled: boolean; status: DemoStatus; context: ProcessingContext | null; liveStages: Stage[]; processedAt: string | null; persisted: boolean; error: string | null;
    process: (inputs: DocumentInput[]) => Promise<ProcessingContext | null>; clear: () => void;
    /** The AI layout gateway, when the server has it enabled; null while unknown. */
    ai: GatewayStatus | null;
    /** Seconds the browser is waiting for the AI provider's per-minute limit before retrying, or null. */
    aiWait: number | null;
    /** The documents of the current processing, as supplied (for the side-by-side document view); empty when none. */
    inputs: DocumentInput[];
    /** Server processing: on when the server runs processing jobs (then the browser only re-checks their result). */
    serverJobs: boolean;
    /** Whether the technical team paused processing, and why; null while unknown or when server processing is off. */
    serverState: ServerProcessingState | null;
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

/** `aiGateway` is the server's own answer to "is the AI gateway enabled?": when it is false the browser never probes the (404) AI routes. */
export function DemoProcessingProvider({ enabled, aiGateway = false, serverJobs = false, children }: { enabled: boolean; aiGateway?: boolean; serverJobs?: boolean; children: React.ReactNode }) {
    const [status, setStatus] = useState<DemoStatus>('loading');
    const [context, setContext] = useState<ProcessingContext | null>(null);
    const [liveStages, setLiveStages] = useState<Stage[]>([]);
    const [processedAt, setProcessedAt] = useState<string | null>(null);
    const [persisted, setPersisted] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [ai, setAi] = useState<GatewayStatus | null>(null);
    const [aiWait, setAiWait] = useState<number | null>(null);
    const [serverState, setServerState] = useState<ServerProcessingState | null>(null);
    const [inputs, setInputs] = useState<DocumentInput[]>([]);
    const run = useRef(0), probe = useRef<Promise<GatewayStatus> | null>(null), uploadLimit = useRef<number | null>(null);
    useEffect(() => { if (enabled && aiGateway) { probe.current = gatewayStatus(); void probe.current.then(setAi); } }, [enabled, aiGateway]);
    useEffect(() => {
        if (!enabled || !serverJobs) return;
        // A pause or resume by Management reaches an open tab within 15 s, and at once when the tab is focused again.
        let live = true;
        const refresh = () => { fetch('/api/processing/jobs', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(b => { if (live && b) { setServerState(b.processing ?? null); uploadLimit.current = typeof b.maxUploadBytes === 'number' ? b.maxUploadBytes : null; } }).catch(() => undefined); };
        const visible = () => { if (document.visibilityState === 'visible') refresh(); };
        refresh();
        const timer = setInterval(refresh, 15_000);
        window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
        return () => { live = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
    }, [enabled, serverJobs]);

    useEffect(() => {
        if (!enabled) return;
        const stored = readStored(), current = ++run.current;
        if (!stored) { queueMicrotask(() => { if (current === run.current) setStatus('empty'); }); return; }
        const restored = stored.documents.map(d => ({ name: d.name, provenance: d.provenance, bytes: fromBase64(d.base64) }));
        browserDemoRunner.run(restored, undefined, { interpreter: replayInterpreter(stored.interpretations ?? {}, null), job: stored.job ? { id: stored.job.id, runner: 'BACKEND_JOB_RUNNER' } : null, extract: stored.extractions ? replayExtractor(stored.extractions) : undefined })
            .then(result => {
                if (current !== run.current) return;
                // A server job's result is shown again only while it still reproduces the job (same pipeline, same readings).
                if (stored.job && result.processingId !== stored.job.processingId) {
                    writeStored(null); setError(`The saved result of server job ${stored.job.id} no longer matches this version of FinGence, so it is not shown. Please process the documents again.`); setStatus('failed'); return;
                }
                setContext(result); setInputs(restored); setLiveStages(result.stages); setProcessedAt(stored.processedAt); setStatus('ready');
            })
            .catch(() => { if (current !== run.current) return; writeStored(null); setStatus('empty'); });
    }, [enabled]);

    const process = useCallback(async (inputs: DocumentInput[]) => {
        // Clear first: a failed or abandoned run can never leave the previous documents' results on screen.
        const current = ++run.current;
        writeStored(null); setContext(null); setInputs([]); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('processing');
        try {
            // If the server says AI is on but the browser's status check has not answered yet (a fast click after a
            // fresh load), wait for it, so an unfamiliar document is never processed without the interpreter by accident.
            let result: ProcessingContext, job: { id: string; processingId: string } | undefined, extractions: Record<string, StoredExtraction> | undefined;
            if (serverJobs) {
                // The server runs the job and stores its results; this browser then re-runs the same pure pipeline on the
                // same documents with the server's accepted layout readings (no model call) and must reach the same ID.
                const outcome = await submitServerJob(inputs, stages => { if (current === run.current) setLiveStages(stages); }, uploadLimit.current);
                if (current !== run.current) return null;
                if ('refusal' in outcome) {
                    if (outcome.state) setServerState(outcome.state);
                    setError(outcome.refusal); setStatus('failed'); return null;
                }
                job = { id: outcome.job.id, processingId: outcome.job.processingId }; extractions = outcome.job.extractions;
                result = await browserDemoRunner.run(inputs, undefined, { interpreter: replayInterpreter(outcome.job.interpretations, null), job: { id: outcome.job.id, runner: 'BACKEND_JOB_RUNNER' }, extract: replayExtractor(outcome.job.extractions) });
                if (current !== run.current) return null;
                if (result.processingId !== outcome.job.processingId) { setError(`This browser's re-check of server job ${outcome.job.id} did not reach the same result, so it is not shown. Your technical team can see the job in Management.`); setStatus('failed'); return null; }
                // The server's progress summaries carry only failed checks; once the re-check agrees, show its full stages.
                setLiveStages(result.stages);
            } else {
            const status = ai ?? (probe.current ? await probe.current : null);
            result = await browserDemoRunner.run(inputs, async stage => {
                if (current !== run.current) return;
                setLiveStages(stages => [...stages, stage]);
                await new Promise(resolve => setTimeout(resolve, 0));
            }, { interpreter: status?.available ? createGatewayInterpreter({ onWait: seconds => { if (current === run.current) setAiWait(seconds); } }) : null });
            }
            if (current !== run.current) return null;
            const at = new Date().toISOString();
            const interpretations = interpretationsOf(result.documents);
            setPersisted(writeStored({ processedAt: at, documents: inputs.map(d => ({ name: d.name, provenance: d.provenance, base64: toBase64(d.bytes) })), interpretations, ...(job ? { job, extractions } : {}) }));
            setContext(result); setInputs(inputs); setProcessedAt(at); setStatus('ready');
            return result;
        } catch {
            if (current === run.current) { setError('Processing stopped unexpectedly. No result was kept.'); setStatus('failed'); }
            return null;
        }
    }, [ai, serverJobs]);
    const clear = useCallback(() => { run.current++; writeStored(null); setContext(null); setInputs([]); setLiveStages([]); setProcessedAt(null); setError(null); setStatus('empty'); }, []);
    const value = useMemo(() => ({ enabled, status: enabled ? status : 'empty' as const, context: enabled ? context : null, liveStages, processedAt, persisted, error, process, clear, ai: enabled ? ai : null, aiWait, serverJobs: enabled && serverJobs, serverState: enabled ? serverState : null, inputs: enabled ? inputs : [] }), [enabled, status, context, liveStages, processedAt, persisted, error, process, clear, ai, aiWait, serverJobs, serverState, inputs]);
    return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemoProcessing() {
    const value = useContext(DemoContext);
    if (!value) throw Error('useDemoProcessing outside DemoProcessingProvider');
    return value;
}
