import { budgetStore } from '@/lib/server/ai/budget';
import { noStoreJson as json } from '@/lib/server/ai/request';
import { getJob } from '@/lib/server/processing/jobs';
import { processingStore, StoreError } from '@/lib/server/processing/store';
import { signedInMember } from '@/lib/server/workspace/session';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A job's status, stages, processing ID and accepted layout readings (so the browser can re-check the result). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!processingStore() || !budgetStore()) return new Response('Not found', { status: 404 });
    const { id } = await params;
    if (!UUID.test(id)) return json({ code: 'NOT_FOUND' }, 404);
    // With the workspace on, only a signed-in member, and only their own organization's jobs.
    const who = await signedInMember(request.headers);
    if ('refusal' in who) return json({ code: who.refusal.code }, who.refusal.status);
    try {
        const job = await getJob(id, false, who.principal ? { organization: who.principal.organization.id } : {});
        return job ? json(job) : json({ code: 'NOT_FOUND' }, 404);
    } catch (error) { return json({ code: error instanceof StoreError ? error.code : 'STORE_FAILED' }, 502); }
}
