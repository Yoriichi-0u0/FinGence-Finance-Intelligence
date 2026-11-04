import { runPayloadSchema } from '@/lib/document-ingestion/run-payload';
import { admit, budgetStore, clientAddress } from '@/lib/server/ai/budget';
import { boundedJson, noStoreJson as json, sameOrigin } from '@/lib/server/ai/request';
import { clientHash, ingestionStore, recordRun } from '@/lib/server/ingestion-store';
import { liveDeps, recordRun as recordWorkspaceRun } from '@/lib/server/workspace/handlers';
import { workspaceEnabled } from '@/lib/server/workspace/store';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 1_500_000;
const notFound = () => new Response('Not found', { status: 404 });

/** Availability only: 404 unless the ingestion store is configured (and a budget store exists to rate-limit writes). */
export async function GET() {
    if (!(ingestionStore() || workspaceEnabled()) || !budgetStore()) return notFound();
    return json({ available: true, workspace: workspaceEnabled(), stores: 'Fingerprints, decisions, model receipts, gate checks and verified records of each document; never the uploaded file.' });
}

/** Saves one completed ingestion run. Same-origin, bounded, schema-validated and rate-limited per client before any write. */
export async function POST(request: Request) {
    // With the workspace on, runs are recorded automatically for a signed-in Finance user's organization, and only then.
    if (workspaceEnabled()) return recordWorkspaceRun(request, liveDeps());
    const store = ingestionStore(), budget = budgetStore();
    if (!store || !budget) return notFound();
    if (!sameOrigin(request.headers)) return json({ code: 'CROSS_ORIGIN' }, 403);
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const parsed = runPayloadSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_RUN', issue: parsed.error.issues[0]?.path.join('.') ?? null }, 400);
    const client = clientAddress(request.headers);
    const admission = await admit({ client, worstCaseUsd: 0 }, budget);
    if (!admission.admitted) return json({ code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) }, admission.status);
    const result = await recordRun({ ...parsed.data, clientHash: clientHash(client, budget.secret) }, store);
    await admission.settle(0);
    return 'runId' in result ? json(result, 201) : json({ code: result.error }, 502);
}
