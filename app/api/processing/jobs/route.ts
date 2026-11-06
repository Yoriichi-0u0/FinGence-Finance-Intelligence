import { after } from 'next/server';
import { admit, budgetStore, clientAddress } from '@/lib/server/ai/budget';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { clientHash } from '@/lib/server/ingestion-store';
import { createJob, decodeDocuments, jobRequestSchema, maxJobBodyBytes, processingState, runJob } from '@/lib/server/processing/jobs';
import { processingStore, StoreError } from '@/lib/server/processing/store';

export const dynamic = 'force-dynamic';
/** A job runs after the response, for at most this long; one that never finishes is failed by the store after 10 minutes. */
export const maxDuration = 300;
const notFound = () => new Response('Not found', { status: 404 });
const storeCode = (error: unknown) => error instanceof StoreError ? error.code : 'STORE_FAILED';

/** Whether server processing is on, and whether it is paused (with the reason Finance users see). */
export async function GET() {
    if (!processingStore() || !budgetStore()) return notFound();
    try { return json({ available: true, processing: await processingState() }); }
    catch (error) { return json({ available: false, code: storeCode(error) }, 503); }
}

/**
 * Submits documents as a processing job: same-origin, bounded, schema-checked and rate-limited per client, then
 * refused with 423 while processing is paused. Answers 202 with the job ID at once; the job runs after the response.
 */
export async function POST(request: Request) {
    const budget = budgetStore();
    if (!processingStore() || !budget) return notFound();
    const read = await boundedJson(request, maxJobBodyBytes());
    if ('refusal' in read) return read.refusal;
    const parsed = jobRequestSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_JOB', issue: parsed.error.issues[0]?.path.join('.') ?? null }, 400);
    const documents = decodeDocuments(parsed.data.documents);
    if ('error' in documents) return json({ code: documents.error }, 413);
    const client = clientAddress(request.headers);
    const admission = await admit({ client, worstCaseUsd: 0 }, budget);
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    await admission.settle(0);
    let created: Awaited<ReturnType<typeof createJob>>;
    try { created = await createJob(documents, clientHash(client, budget.secret)); }
    catch (error) { return json({ code: storeCode(error) }, 502); }
    if ('error' in created) return json({ code: created.error, reason: created.reason, since: created.since }, 423);
    after(() => runJob(created.jobId, documents, client));
    return json({ jobId: created.jobId }, 202);
}
