import { z } from 'zod';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { getJob, overview, setPaused } from '@/lib/server/processing/jobs';
import { managementEnabled, StoreError } from '@/lib/server/processing/store';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = () => new Response('Not found', { status: 404 });
const failed = (error: unknown) => json({ code: error instanceof StoreError ? error.code : 'STORE_FAILED' }, 502);
const actionSchema = z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('pause'), reason: z.string().trim().min(1).max(300) }),
    z.strictObject({ action: z.literal('resume') }),
]);

/** Management (Technical): the pause state, recent jobs and flagged items; with `?job=<id>`, one job's stored results. */
export async function GET(request: Request) {
    if (!managementEnabled()) return notFound();
    const job = new URL(request.url).searchParams.get('job');
    try {
        if (job === null) return json(await overview());
        if (!UUID.test(job)) return json({ code: 'NOT_FOUND' }, 404);
        const detail = await getJob(job, true);
        return detail ? json(detail) : json({ code: 'NOT_FOUND' }, 404);
    } catch (error) { return failed(error); }
}

/** Pause (with a reason Finance users see) or resume the organization's processing. Same-origin only. */
export async function POST(request: Request) {
    if (!managementEnabled()) return notFound();
    const read = await boundedJson(request, 4_000);
    if ('refusal' in read) return read.refusal;
    const parsed = actionSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_ACTION' }, 400);
    try {
        const out = await setPaused(parsed.data.action === 'pause', parsed.data.action === 'pause' ? parsed.data.reason : null);
        return out?.error ? json({ code: out.error }, 400) : json({ paused: out?.paused === true });
    } catch (error) { return failed(error); }
}
