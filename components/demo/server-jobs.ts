'use client';
import type { DocumentInput, Stage } from '@/lib/demo/pipeline';
import type { InterpretationResult } from '@/lib/interpretation/contracts';
import type { StageSummary } from '@/lib/processing/job-result';
import type { StoredExtraction } from '@/lib/processing/extractions';

/** Browser side of server processing: submit the documents as a job, follow its stages, return the finished job. */
export type ServerProcessingState = { paused: boolean; reason: string | null; changedAt: string | null };
export type FinishedJob = { id: string; processingId: string; interpretations: Record<string, InterpretationResult>; extractions: Record<string, StoredExtraction> };
type JobBody = { id: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'; stages: StageSummary[]; processingId: string | null; interpretations: Record<string, InterpretationResult>; extractions?: Record<string, StoredExtraction>; error: string | null; code?: string };

const POLL_MS = 700;
/** A job the server has not finished in this long is treated as stopped (the store fails it after 10 minutes). */
const GIVE_UP_MS = 6 * 60_000;
/** Room left in a job request for the form's own framing (part headers, boundaries and the manifest). */
const FORM_OVERHEAD_BYTES = 16_384;
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
/** The documents as raw bytes in one multipart form, so a job may carry nearly the whole request limit. */
export function jobForm(inputs: DocumentInput[]) {
    const form = new FormData();
    form.append('manifest', JSON.stringify(inputs.map(d => ({ name: d.name, provenance: d.provenance }))));
    for (const d of inputs) form.append('document', new Blob([d.bytes as Uint8Array<ArrayBuffer>]), d.name);
    return form;
}
const tooLarge = (total: number, max?: number) => `These documents total ${megabytes(total)}, more than the FinGence server accepts in one job${max ? ` (${megabytes(max - FORM_OVERHEAD_BYTES)})` : ''}. Nothing was processed. Try fewer files at a time, or smaller scans or photos.`;
const asStage = (s: StageSummary): Stage => ({ id: s.id, title: s.title, decision: s.decision, method: 'Server processing job', summary: s.summary, checks: s.failedChecks.map(k => ({ ...k, passed: false })) });
export const pausedMessage = (state: ServerProcessingState) => `Processing is paused by your technical team${state.reason ? `: ${state.reason}` : ''}. Your documents were not processed; please try again later.`;
const REFUSAL: Record<string, string> = {
    DOCUMENT_TOO_LARGE: 'One of the documents is larger than 4 MB.',
    CLIENT_RATE_LIMITED: 'Too many processing requests from this browser in the last minute. Please wait a minute and try again.',
    RATE_LIMITED: 'FinGence is busy processing other documents. Please wait a minute and try again.',
    CLIENT_DAILY_LIMIT: 'This browser has reached today\'s processing limit. Please try again tomorrow.',
    DAILY_LIMIT: 'FinGence has reached today\'s processing limit. Please try again tomorrow.',
};

/**
 * `maxUploadBytes` is the server's request limit (from its status), so a set too large to send is refused here with
 * its size; a refusal by the hosting platform itself (413 without a FinGence body) is explained the same way.
 */
export async function submitServerJob(inputs: DocumentInput[], onStages: (stages: Stage[]) => void, maxUploadBytes?: number | null, sleep = (ms: number) => new Promise(r => setTimeout(r, ms))): Promise<{ job: FinishedJob } | { refusal: string; state?: ServerProcessingState }> {
    const total = inputs.reduce((n, d) => n + d.bytes.byteLength, 0);
    if (maxUploadBytes && total + FORM_OVERHEAD_BYTES > maxUploadBytes) return { refusal: tooLarge(total, maxUploadBytes) };
    let res: Response;
    try { res = await fetch('/api/processing/jobs', { method: 'POST', body: jobForm(inputs) }); }
    catch { return { refusal: 'The FinGence server could not be reached. Nothing was processed.' }; }
    const body = await res.json().catch(() => null) as { jobId?: string; code?: string; reason?: string | null; since?: string | null; maxBytes?: number } | null;
    if (res.status === 413 && body?.code !== 'DOCUMENT_TOO_LARGE') return { refusal: tooLarge(total, body?.maxBytes ?? maxUploadBytes ?? undefined) };
    if (res.status === 423) { const state = { paused: true, reason: body?.reason ?? null, changedAt: body?.since ?? null }; return { refusal: pausedMessage(state), state }; }
    if (res.status !== 202 || !body?.jobId) return { refusal: REFUSAL[body?.code ?? ''] ?? `The server did not accept the documents for processing (${body?.code ?? `HTTP ${res.status}`}).` };
    const jobId = body.jobId, started = Date.now();
    for (;;) {
        await sleep(POLL_MS);
        const job = await fetch(`/api/processing/jobs/${jobId}`, { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<JobBody> : null).catch(() => null);
        if (job) {
            onStages(job.stages.map(asStage));
            if (job.status === 'COMPLETED' && job.processingId) return { job: { id: job.id, processingId: job.processingId, interpretations: job.interpretations ?? {}, extractions: job.extractions ?? {} } };
            if (job.status === 'FAILED') return { refusal: `Processing job ${jobId} stopped on the server (${job.error ?? 'unknown reason'}). No result was kept. Your technical team can see it in Management.` };
        }
        if (Date.now() - started > GIVE_UP_MS) return { refusal: `Processing job ${jobId} did not finish in time. No result was kept.` };
    }
}
