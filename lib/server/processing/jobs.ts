import 'server-only';
import { z } from 'zod';
import { MAX_DOCUMENT_BYTES, processDocuments, sha256Hex, type DocumentInput, type Stage } from '../../demo/pipeline';
import { runPayload, runPayloadSchema } from '../../document-ingestion/run-payload';
import { InterpreterUnavailable, type InterpretationResult, type LayoutInterpreter } from '../../interpretation/contracts';
import type { Extractor } from '../../interpretation/extract';
import { recordingExtractor, type StoredExtraction } from '../../processing/extractions';
import { jobResult, MAX_FLAGGED, stageSummary, type FlaggedItem, type StageSummary } from '../../processing/job-result';
import { aiGatewayEnabled } from '../ai/groq-interpreter';
import { serverInterpreter } from '../ai/interpret';
import { PROCESSING_ORGANIZATION, rpc, StoreError, type ProcessingStore } from './store';
import { savedRunPayload } from '../../history/saved-run';
import { saveRun } from '../history/save';
import { interpretationsOf } from '../../document-ingestion/ingest';

/**
 * Server processing jobs. A job is created (unless processing is paused), answered at once with its ID, and then run
 * by the server through the same pure pipeline the browser uses, with the AI layout reader called in-process from the
 * shared budget. Each stage is recorded as it finishes. A finished job stores, in one transaction, its ingestion run
 * (fingerprints, decisions, model receipts, gate checks and verified records), its reconciliation and anomaly results
 * and every flagged item. The uploaded documents exist only in the job's memory and are never stored.
 */
export const MAX_JOB_DOCUMENTS = 8;
/**
 * A hosted function accepts at most 4.5 MB per request, so there a job's documents, sent as raw bytes in one multipart
 * form, must total about 4.3 MB. A local server has no such limit: up to MAX_JOB_DOCUMENTS documents of at most 4 MB each.
 */
export const HOSTED_JOB_BODY_BYTES = 4_400_000;
export const maxJobBodyBytes = (env: Readonly<Record<string, string | undefined>> = process.env) => env.VERCEL ? HOSTED_JOB_BODY_BYTES : 40_000_000;
/** The form's `manifest` field: each document's name and provenance, in the order of its `document` file parts. */
export const jobManifestSchema = z.array(z.strictObject({
    name: z.string().min(1).max(160), provenance: z.enum(['PUBLIC_SYNTHETIC_SAMPLE', 'USER_SUPPLIED']),
})).min(1).max(MAX_JOB_DOCUMENTS);
type Refusal = { status: 400 | 413; code: string; issue?: string | null };

/** The job's documents from a submitted form: a manifest plus exactly one non-empty file part per manifest entry. */
export async function decodeJobForm(form: FormData): Promise<DocumentInput[] | Refusal> {
    const raw = form.get('manifest');
    let manifest: unknown;
    try { manifest = typeof raw === 'string' ? JSON.parse(raw) : undefined; } catch { manifest = undefined; }
    const parsed = jobManifestSchema.safeParse(manifest);
    if (!parsed.success) return { status: 400, code: 'INVALID_JOB', issue: parsed.error.issues[0]?.path.join('.') ?? null };
    const files = form.getAll('document');
    if (files.length !== parsed.data.length || [...form.keys()].some(k => k !== 'manifest' && k !== 'document')) return { status: 400, code: 'INVALID_JOB', issue: 'document' };
    const out: DocumentInput[] = [];
    for (const [i, file] of files.entries()) {
        if (typeof file === 'string') return { status: 400, code: 'INVALID_JOB', issue: `document.${i}` };
        if (!file.size || file.size > MAX_DOCUMENT_BYTES) return { status: 413, code: 'DOCUMENT_TOO_LARGE' };
        out.push({ name: parsed.data[i].name, provenance: parsed.data[i].provenance, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    return out;
}
export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ProcessingState = { paused: boolean; reason: string | null; changedAt: string | null };
export type JobView = {
    id: string; createdAt: string; startedAt: string | null; finishedAt: string | null; status: JobStatus;
    inputs: { name: string; sha256: string; bytes: number; provenance: string }[]; stages: StageSummary[];
    pipelineVersion: string | null; processingId: string | null; outcome: string | null; scope: unknown; summary: string | null; flaggedCount: number;
    interpretations: Record<string, InterpretationResult>; extractions: Record<string, StoredExtraction>; ingestionRunId: string | null; error: string | null;
    results?: { reconciliation: unknown; anomalies: unknown; report: unknown; documents: unknown } | null; flagged?: (FlaggedItem & { ordinal: number })[];
};
type Deps = { store?: ProcessingStore | null; transport?: typeof fetch; interpreter?: LayoutInterpreter | null; organization?: string;
    /** The signed-in member who submitted the job (workspace on); shown as "by" on the Technical log. */
    member?: string;
    /** Where a completed run is saved for its person (tests replace it). */
    saveRun?: typeof saveRun; timeoutMs?: number; extractor?: Extractor; maxFlagged?: number };
/** A job stops itself before the 300 s a hosted function may run, so it is failed with a reason instead of cut off. */
export const JOB_TIMEOUT_MS = 280_000;
class JobTimeout extends Error {}
const call = <T>(fn: string, args: Record<string, unknown>, deps: Deps) => rpc<T>(fn, args, deps.store, deps.transport);

export const processingState = (deps: Deps = {}) => call<ProcessingState>('fingence_processing_state', { org: deps.organization ?? PROCESSING_ORGANIZATION }, deps);

/** Creates the job, or refuses when the organization's processing is paused (checked by the store in the same statement). */
export async function createJob(documents: DocumentInput[], clientHash: string | null, deps: Deps = {}): Promise<{ jobId: string } | { error: 'PROCESSING_PAUSED'; reason: string | null; since: string | null }> {
    const inputs = await Promise.all(documents.map(async d => ({ name: d.name, sha256: await sha256Hex(d.bytes), bytes: d.bytes.byteLength, provenance: d.provenance })));
    const out = await call<{ jobId?: string; error?: string; reason?: string | null; since?: string | null }>('fingence_processing_create_job', { org: deps.organization ?? PROCESSING_ORGANIZATION, inputs, client: clientHash, ...(deps.member ? { member: deps.member } : {}) }, deps);
    if (out?.jobId) return { jobId: out.jobId };
    if (out?.error === 'PROCESSING_PAUSED') return { error: 'PROCESSING_PAUSED', reason: out.reason ?? null, since: out.since ?? null };
    throw new StoreError('CREATE_FAILED');
}

/** Runs a created job to the end. Never throws: any failure is recorded on the job as a short code. */
export async function runJob(jobId: string, documents: DocumentInput[], client: string, deps: Deps = {}): Promise<JobStatus> {
    try {
        if (!await call<boolean>('fingence_processing_start_job', { job: jobId }, deps)) return 'FAILED';
        const extractions: Record<string, StoredExtraction> = {};
        const base = deps.interpreter !== undefined ? deps.interpreter : aiGatewayEnabled() ? serverInterpreter(client) : null;
        // Once the job is out of time (or the store no longer has it running), nothing more is read, sent to the
        // model or calculated: every reader call and every stage boundary checks that the job is still live.
        const stop = new AbortController();
        const live = () => { if (stop.signal.aborted) throw new JobTimeout(); };
        const interpreter: LayoutInterpreter | null = base && { propose: async evidence => { if (stop.signal.aborted) throw new InterpreterUnavailable('JOB_STOPPED'); return base.propose(evidence); } };
        const read = recordingExtractor(extractions, deps.extractor);
        const extract: Extractor = async (name, bytes, sha256) => stop.signal.aborted ? { error: 'The processing job stopped.' } : read(name, bytes, sha256);
        const onStage = async (stage: Stage) => {
            live();
            if (!await call<boolean>('fingence_processing_job_stage', { job: jobId, stage: stageSummary(stage) }, deps)) { stop.abort(); throw new JobTimeout(); }
            live();
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const context = await Promise.race([
            processDocuments(documents, sha256Hex, onStage, { interpreter, job: { id: jobId, runner: 'BACKEND_JOB_RUNNER' }, extract }),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { stop.abort(); reject(new JobTimeout()); }, deps.timeoutMs ?? JOB_TIMEOUT_MS); }),
        ]).finally(() => clearTimeout(timer));
        const run = runPayloadSchema.safeParse(runPayload(context));
        if (!run.success) { await call('fingence_processing_fail_job', { job: jobId, code: 'INVALID_RUN' }, deps); return 'FAILED'; }
        const result = jobResult(context);
        if (result.flagged.length > (deps.maxFlagged ?? MAX_FLAGGED)) { await call('fingence_processing_fail_job', { job: jobId, code: 'TOO_MANY_FLAGGED' }, deps); return 'FAILED'; }
        const done = await call<{ jobId?: string; error?: string }>('fingence_processing_finish_job', { job: jobId, run: run.data, result: { ...result, extractions } }, deps);
        if (!done?.jobId) return 'FAILED';
        // The person's History: the documents and the bundle that reproduces this result. A save that fails never fails the job.
        if (deps.member && deps.organization) {
            const payload = await savedRunPayload(context, documents, { interpretations: interpretationsOf(context.documents), extractions, job: { id: jobId, processingId: context.processingId } }, new Date().toISOString());
            await (deps.saveRun ?? saveRun)(deps.organization, deps.member, payload, documents).catch(() => undefined);
        }
        return 'COMPLETED';
    } catch (error) {
        const code = error instanceof StoreError ? error.code : error instanceof JobTimeout ? 'TIMED_OUT' : 'PROCESSING_FAILED';
        await call('fingence_processing_fail_job', { job: jobId, code }, deps).catch(() => undefined);
        return 'FAILED';
    }
}

export const getJob = (jobId: string, detail: boolean, deps: Deps = {}) => call<JobView | null>('fingence_processing_get_job', { org: deps.organization ?? PROCESSING_ORGANIZATION, job: jobId, detail }, deps);
export type Overview = {
    processing: ProcessingState; counts: { jobs: number; running: number; failed: number };
    jobs: (Pick<JobView, 'id' | 'createdAt' | 'startedAt' | 'finishedAt' | 'status' | 'processingId' | 'outcome' | 'scope' | 'summary' | 'flaggedCount' | 'ingestionRunId' | 'error'> & { documents: number; stage: string | null })[];
    flagged: (FlaggedItem & { ordinal: number; jobId: string; createdAt: string; scope: JobView['scope'] })[];
};
export const overview = (deps: Deps = {}) => call<Overview>('fingence_processing_overview', { org: deps.organization ?? PROCESSING_ORGANIZATION, max_jobs: 30 }, deps);
export async function setPaused(paused: boolean, reason: string | null, deps: Deps = {}) {
    return call<{ paused?: boolean; error?: string }>('fingence_processing_set_paused', { org: deps.organization ?? PROCESSING_ORGANIZATION, p_paused: paused, reason }, deps);
}
