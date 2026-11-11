import { after } from 'next/server';
import { admit, budgetStore, clientAddress } from '@/lib/server/ai/budget';
import { boundedForm, noStoreJson as json } from '@/lib/server/ai/request';
import { clientHash } from '@/lib/server/ingestion-store';
import { createJob, decodeJobForm, maxJobBodyBytes, processingState, runJob } from '@/lib/server/processing/jobs';
import { processingStore, StoreError } from '@/lib/server/processing/store';
import { processingGate, signedInMember } from '@/lib/server/workspace/session';

export const dynamic = 'force-dynamic';
/** A job runs after the response, for at most this long; one that never finishes is failed by the store after 10 minutes. */
export const maxDuration = 300;
const notFound = () => new Response('Not found', { status: 404 });
const storeCode = (error: unknown) => error instanceof StoreError ? error.code : 'STORE_FAILED';

/**
 * Whether server processing is on, whether it is paused (with the reason Finance users see), and the most a job's
 * request may carry, so the browser can refuse an oversized set itself instead of meeting the platform's own refusal.
 */
export async function GET(request: Request) {
    if (!processingStore() || !budgetStore()) return notFound();
    // With the workspace on (SAIC only), a signed-in member sees their organization's pause, set by an Admin.
    const who = await signedInMember(request.headers);
    if ('refusal' in who) return json({ code: who.refusal.code }, who.refusal.status);
    const p = who.principal;
    try { return json({ available: true, processing: p ? { paused: p.processing.paused, reason: p.processing.reason, changedAt: p.processing.since } : await processingState(), maxUploadBytes: maxJobBodyBytes() }); }
    catch (error) { return json({ available: false, code: storeCode(error) }, 503); }
}

/**
 * Submits documents (one multipart form of raw file bytes) as a processing job: same-origin, bounded, schema-checked and rate-limited per client, then
 * refused with 423 while processing is paused. Answers 202 with the job ID at once; the job runs after the response.
 */
export async function POST(request: Request) {
    const budget = budgetStore();
    if (!processingStore() || !budget) return notFound();
    const read = await boundedForm(request, maxJobBodyBytes());
    if ('refusal' in read) return read.refusal;
    // With the workspace on, only a signed-in member of an organization whose processing is not paused may submit; the
    // job belongs to that organization, and while a Superadmin has turned the AI off it runs on the rules alone.
    const gate = await processingGate(request.headers);
    if ('refusal' in gate) return json({ code: gate.refusal.code, ...(gate.refusal.reason ? { reason: gate.refusal.reason } : {}) }, gate.refusal.status);
    const scope = gate.principal ? { organization: gate.principal.organization.id, ...(gate.principal.ai.enabled ? {} : { interpreter: null }) } : {};
    const documents = await decodeJobForm(read.form);
    if ('code' in documents) return json({ code: documents.code, ...(documents.issue !== undefined ? { issue: documents.issue } : {}) }, documents.status);
    const client = clientAddress(request.headers);
    const admission = await admit({ client, worstCaseUsd: 0 }, budget);
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    await admission.settle(0);
    let created: Awaited<ReturnType<typeof createJob>>;
    try { created = await createJob(documents, clientHash(client, budget.secret), scope); }
    catch (error) { return json({ code: storeCode(error) }, 502); }
    if ('error' in created) return json({ code: created.error, reason: created.reason, since: created.since }, 423);
    after(() => runJob(created.jobId, documents, client, scope));
    return json({ jobId: created.jobId }, 202);
}
