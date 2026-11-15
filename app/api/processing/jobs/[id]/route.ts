import { budgetStore } from '@/lib/server/ai/budget';
import { noStoreJson as json } from '@/lib/server/ai/request';
import { getJob } from '@/lib/server/processing/jobs';
import { processingStore, StoreError } from '@/lib/server/processing/store';
import { caller, signedInMember } from '@/lib/server/workspace/session';

import { ownsFinancialResource } from '@/lib/server/workspace/ownership';
import { workspaceStore } from '@/lib/server/workspace/store';

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
        if(who.principal){
            const identity=await caller(request.headers);
            if(identity.kind!=='SIGNED_IN')return json({code:'SIGN_IN_REQUIRED'},401);
            const ownership=await ownsFinancialResource(identity.tokenHash,'JOB',id,workspaceStore());
            if(ownership!=='OWNED')return json({code:ownership==='DENIED'?'NOT_FOUND':'WORKSPACE_UNAVAILABLE'},ownership==='DENIED'?404:503);
        }
        const job = await getJob(id, false, who.principal ? { organization: who.principal.organization.id } : {});
        return job ? json(job) : json({ code: 'NOT_FOUND' }, 404);
    } catch (error) { return json({ code: error instanceof StoreError ? error.code : 'STORE_FAILED' }, 502); }
}
