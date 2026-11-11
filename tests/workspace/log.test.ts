import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import type { DocumentInput } from '../../lib/demo/pipeline';
import * as h from '../../lib/server/workspace/handlers';
import { aiCaller } from '../../lib/server/workspace/session';
import { createJob, runJob } from '../../lib/server/processing/jobs';
import type { ProcessingStore } from '../../lib/server/processing/store';
import { newSecret, rpc, secretHash, type Store } from '../../lib/server/workspace/store';
import { runAsCaller, setAiCallSink, withAiCall } from '../../lib/ai-calls';
import { rpcTransport, workspaceDatabase } from './db';

/**
 * The Technical log end to end, against the real migrations (workspace v1, v2 and v3-log) in an in-memory Postgres:
 * a server job records who ran it, its run reaches the log, AI calls arrive through the door, and only Admins and
 * Superadmins of the organization can read it.
 */
const ORIGIN = 'http://localhost:3000';
const store: Store = { url: 'https://example-project.supabase.co', key: 'sb_secret_not_real' };
const jobStore: ProcessingStore = { url: store.url, key: store.key, local: false };
let db: PGlite, deps: h.Deps, organizationId: string;
const req = (path: string, cookie?: string, body?: unknown) => new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { host: 'localhost:3000', origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0];
async function redeem(code: string) { return cookieOf(await h.join(req('/api/workspace/join', undefined, { code, password: 'correct horse battery' }), deps)); }
async function invite(by: string, email: string, role: string) { return (await (await h.teamChange(req('/api/workspace/team', by, { action: 'invite', email, role }), deps)).json()).code as string; }
const memberId = async (email: string) => (await db.query<{ id: string }>('select id::text from fingence_workspace.members where email = $1', [email])).rows[0].id;
const log = async (cookie: string, days = 7) => { const res = await h.technicalLog(req(`/api/workspace/log?days=${days}`, cookie), deps); return [res.status, await res.json()] as const; };
const doc = (name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join('public/demo', name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const march = () => ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv'].map(doc);
const completion = { id: 'chatcmpl-1', model: 'openai/gpt-oss-120b', choices: [{ message: { content: 'MYR 999.99 to Lucky Star' } }], usage: { prompt_tokens: 900, completion_tokens: 100 } };

let superadmin: string, admin: string, finance: string;
beforeAll(async () => {
    db = await workspaceDatabase();
    deps = { store, transport: rpcTransport(db), attempts: async () => true };
    const code = newSecret();
    await db.query('select public.fingence_workspace_bootstrap($1, $2, $3)', ['SAIC', 'super@example.invalid', secretHash(code)]);
    superadmin = await redeem(code);
    admin = await redeem(await invite(superadmin, 'admin@example.invalid', 'ADMIN'));
    finance = await redeem(await invite(admin, 'finance@example.invalid', 'FINANCE'));
    organizationId = (await db.query<{ id: string }>('select id::text from fingence_workspace.organizations')).rows[0].id;
}, 60_000);
afterEach(() => setAiCallSink(null));

describe('the Technical log', () => {
    it('a server job records who ran it, and its run reaches the log (it did not before v3)', async () => {
        const member = await memberId('finance@example.invalid');
        const scope = { store: jobStore, transport: deps.transport, interpreter: null, organization: organizationId, member };
        const created = await createJob(march(), null, scope) as { jobId: string };
        expect(await runJob(created.jobId, march(), '127.0.0.1', scope)).toBe('COMPLETED');
        const [status, out] = await log(admin);
        expect(status).toBe(200);
        expect(out.runs).toHaveLength(1);
        expect(out.runs[0]).toMatchObject({ by: 'finance@example.invalid', source: 'SERVER', jobId: created.jobId, outcome: expect.any(String) });
        expect(out.runs[0].documents.map((d: { method: string; decision: string }) => [d.method, d.decision])).toEqual([['EXACT_SIGNATURE', 'AUTO_ACCEPTED'], ['EXACT_SIGNATURE', 'AUTO_ACCEPTED']]);
        // A server job also brings each stage's decision, so the log can say how many stages were verified.
        expect(out.runs[0].stages.length).toBeGreaterThan(4);
        expect(out.runs[0].stages[0]).toEqual({ title: expect.any(String), decision: expect.any(String), failedChecks: expect.any(Number) });
        // The existing Operations view sees it too, with the member.
        const ops = await (await h.operations(req('/api/workspace/operations', admin), deps)).json();
        expect(ops.runs[0]).toMatchObject({ by: 'finance@example.invalid', documents: 2 });
    });
    it('a job cannot be attributed to someone outside the organization', async () => {
        const outsider = '00000000-0000-4000-8000-000000000009';
        const out = await rpc('fingence_processing_create_job', { org: organizationId, inputs: [{ name: 'a.csv', sha256: 'a'.repeat(64), bytes: 1, provenance: 'USER_SUPPLIED' }], client: null, member: outsider }, store, deps.transport);
        expect(out).toEqual({ ok: false, error: 'MEMBER_MISMATCH' });
    });
    it('AI calls arrive through the door with who made them, and the log never holds what the model was sent or said', async () => {
        const member = await memberId('admin@example.invalid');
        // The door's production sink, pointed at the in-memory database.
        setAiCallSink(async (call, caller) => { await rpc('fingence_workspace_record_ai_call', { p_call: { ...call, ...caller } }, store, deps.transport); });
        await runAsCaller({ organizationId, memberId: member, jobId: null }, () => withAiCall({ feature: 'recon-suggest', model: 'openai/gpt-oss-120b', keyLabel: 'celester-groq' }, async () => completion, () => ({ verdict: 'ACCEPTED' })));
        await runAsCaller({ organizationId, memberId: member, jobId: null }, () => withAiCall({ feature: 'finance-qa', model: 'openai/gpt-oss-120b' }, async () => { throw Object.assign(new Error('x'), { status: 429 }); })).catch(() => undefined);
        const [, out] = await log(superadmin);
        expect(out.aiCalls.map((c: { feature: string; status: string; verdict: string | null; by: string; keyLabel: string | null }) => [c.feature, c.status, c.verdict, c.by, c.keyLabel]))
            .toEqual([['finance-qa', 'RATE_LIMITED', null, 'admin@example.invalid', null], ['recon-suggest', 'OK', 'ACCEPTED', 'admin@example.invalid', 'celester-groq']]);
        expect(out.aiCalls[1]).toMatchObject({ inputTokens: 900, outputTokens: 100, requestId: 'chatcmpl-1' });
        expect(JSON.stringify(out)).not.toMatch(/999\.99|Lucky Star|signed_cents|signedCents/);
    });
    it('the database refuses a call outside the contract, and one for a member of no organization', async () => {
        const base = { feature: 'finance-qa', provider: 'GROQ', model: 'openai/gpt-oss-120b', keyLabel: null, requestId: null, status: 'OK', verdict: null, reasonCode: null, inputTokens: 1, outputTokens: 1, estimatedUsd: 0, latencyMs: 1, processingId: null, organizationId, memberId: null, jobId: null };
        expect((await rpc('fingence_workspace_record_ai_call', { p_call: { ...base, feature: 'Bad Feature!' } }, store, deps.transport)).ok).toBe(false);
        expect((await rpc('fingence_workspace_record_ai_call', { p_call: { ...base, memberId: '00000000-0000-4000-8000-000000000009' } }, store, deps.transport))).toEqual({ ok: false, error: 'MEMBER_MISMATCH' });
        expect((await rpc('fingence_workspace_record_ai_call', { p_call: base }, store, deps.transport)).ok).toBe(true);
    });
    it('totals and the daily counts cover the whole period, even when the timeline is capped', async () => {
        const before = (await log(admin))[1].totals.aiCalls;
        await db.query(`insert into fingence_workspace.ai_calls (organization_id, feature, provider, model, status, latency_ms, occurred_at)
            select $1::uuid, 'finance-qa', 'GROQ', 'openai/gpt-oss-120b', case when g % 10 = 0 then 'FAILED' else 'OK' end, 100, now() - (g || ' minutes')::interval from generate_series(1, 1005) g`, [organizationId]);
        const [, out] = await log(admin);
        expect(out.aiCalls).toHaveLength(out.limits.aiCalls);
        expect(out.totals.aiCalls).toBe(before + 1005);
        expect(out.daily.reduce((s: number, d: { ok: number; problem: number }) => s + d.ok + d.problem, 0)).toBe(out.totals.aiCalls);
        expect(out.totals.aiProblems).toBeGreaterThanOrEqual(100);
        expect(out.totals).toMatchObject({ runs: 1, serverRuns: 1, documents: 2, documentsByAi: 0 });
    });
    it('only Admins and Superadmins read it; a Finance user and a visitor are refused, in the server and the database', async () => {
        expect((await log(finance))[0]).toBe(403);
        expect((await h.technicalLog(req('/api/workspace/log'), deps)).status).toBe(401);
        expect((await log(admin, 3))[0]).toBe(400);
        const t = secretHash(finance.split('=')[1]);
        expect((await db.query<{ r: unknown }>('select public.fingence_workspace_log($1, now() - interval \'1 day\') r', [t])).rows[0].r).toEqual({ error: 'FORBIDDEN' });
    });
    it('only the service role may record or read, and the table cannot be read directly', async () => {
        for (const fn of ['fingence_workspace_record_ai_call(jsonb)', 'fingence_workspace_log(text, timestamptz)', 'fingence_processing_create_job(text, jsonb, text, uuid)']) {
            const { rows } = await db.query<{ anon: boolean; service: boolean }>(`select has_function_privilege('anon', 'public.${fn}', 'execute') anon, has_function_privilege('service_role', 'public.${fn}', 'execute') service`);
            expect(rows[0]).toEqual({ anon: false, service: true });
        }
        const { rows } = await db.query<{ select: boolean }>("select has_table_privilege('authenticated', 'fingence_workspace.ai_calls', 'select') as select");
        expect(rows[0].select).toBe(false);
    });
    it('the caller helper attributes a member, or nothing when the workspace is off', () => {
        expect(aiCaller(null)).toBeNull();
    });
});
