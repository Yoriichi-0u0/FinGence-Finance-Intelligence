import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({ enabled: true, runtime: vi.fn() }));
vi.mock('../../lib/server/ai-ingestion/m2/runtime', () => ({ m2LocalEnabled: () => mock.enabled, m2Runtime: mock.runtime }));
import { GET, POST } from '../../app/api/ai-ingestion/m2/route';
const session = { session: vi.fn(), login: vi.fn(), logout: vi.fn() }, pipeline = { reserve: vi.fn(), process: vi.fn(), get: vi.fn(), list: vi.fn(), investigate: vi.fn(), cancel: vi.fn(),reference:vi.fn() };
const url = 'http://127.0.0.1:3182/api/ai-ingestion/m2';
function req(action: string, method = 'GET', body?: BodyInit, host = '127.0.0.1:3182') {
    return new Request(url + '?' + action, { method, headers: { host, origin: 'http://' + host, cookie: 'fingence_m2_session=' + 'a'.repeat(43), ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) }, body });
}
beforeEach(() => { vi.resetAllMocks(); mock.enabled = true; vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('VERCEL', ''); vi.stubEnv('FINGENCE_AI_LOCAL', '1'); mock.runtime.mockResolvedValue({ identity: session, pipeline }); session.session.mockResolvedValue({ role: 'Finance' }); });
afterEach(() => vi.unstubAllEnvs());
describe('local V2 financial HTTP boundary', () => {
    it.each(['GET', 'POST'])('blocks %s before opening a database when capability disabled', async (method) => { mock.enabled = false; expect((await (method === 'GET' ? GET : POST)(req('', method))).status).toBe(404); expect(mock.runtime).not.toHaveBeenCalled(); });
    it('rejects external host/origin', async () => { expect((await POST(req('action=reserve', 'POST', undefined, 'example.com'))).status).toBe(404); expect(mock.runtime).not.toHaveBeenCalled(); });
    it('denies missing or revoked membership without financial delivery', async () => { session.session.mockRejectedValue(new Error('denied')); expect((await POST(req('action=reserve', 'POST'))).status).toBe(404); expect(pipeline.reserve).not.toHaveBeenCalled(); });
    it('reports inactive sessions without echoing credentials', async () => { session.session.mockRejectedValue(new Error('denied')); expect(await (await GET(req('action=session'))).json()).toEqual({ active: false }); });
    it('streams stages and the reserved original operation without accepting financial JSON', async () => { pipeline.process.mockImplementation(async (_t, id, _b, _f, emit) => { emit({ name: 'verification', state: 'COMPLETED' }); return { id }; }); const form = new FormData(); form.append('file', new File(['synthetic'], 'uploaded.csv')); const response = await POST(req('action=process&id=operation', 'POST', form)); const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line)); expect(lines).toEqual([{ stage: { name: 'verification', state: 'COMPLETED' } }, { result: { id: 'operation' } }]); expect(pipeline.process).toHaveBeenCalledTimes(1); });
    it('rejects browser-supplied user, tenant and verification claims', async () => { const form = new FormData(); form.append('file', new File(['synthetic'], 'uploaded.csv')); form.append('tenant', 'forged'); expect((await POST(req('action=process&id=operation', 'POST', form))).status).toBe(404); expect(pipeline.process).not.toHaveBeenCalled(); });
    it('preserves warning policy and exact cited deterministic answers', async () => { const group = { total: '105.5', currency: 'MYR', status: 'AVAILABLE', sources: [{ recordId: 'source', evidenceIds: ['cell'] }] }; pipeline.get.mockResolvedValue({ report: { groups: [group] } }); const response = await POST(req('action=question&id=original&warnings=include', 'POST', JSON.stringify({ question: 'What is the source-signed total?' }))); expect(pipeline.get).toHaveBeenCalledWith('a'.repeat(43), 'original', 'include'); expect(await response.json()).toEqual({ status: 'DETERMINISTIC_ONLY', claims: [group], publicationEligible: false }); });
    it('does not fabricate unsupported revenue, forecasts or live model answers', async () => { pipeline.get.mockResolvedValue({ report: null }); expect(await (await POST(req('action=question&id=original', 'POST', JSON.stringify({ question: 'Predict revenue' })))).json()).toMatchObject({ status: 'UNSUPPORTED' }); });
    it('uses a safe ambiguous failure response and does not retry processing', async () => { pipeline.process.mockRejectedValue(new Error('private SQL detail')); const form = new FormData(); form.append('file', new File(['synthetic'], 'uploaded.csv')); const text = await (await POST(req('action=process&id=original', 'POST', form))).text(); expect(text).toContain('not confirmed'); expect(text).not.toContain('private SQL'); expect(pipeline.process).toHaveBeenCalledTimes(1); });
});

it('returns verified principal identity/version for client cache fencing without exposing session tokens',async()=>{
 session.session.mockResolvedValue({role:'Finance',userId:'u',organizationId:'o',membershipVersion:2});
 expect(await(await GET(req('action=session'))).json()).toEqual({active:true,role:'Finance',userId:'u',organizationId:'o',membershipVersion:2,mode:'SIMULATED',liveProviderAvailable:false});
});
it('supplies the login principal so Finance → Finance account switches can invalidate cached results',async()=>{
 session.login.mockResolvedValue({token:'a'.repeat(43),principal:{user_id:'u',organization_id:'o',role:'Finance',version:2}});
 const response=await POST(req('action=login','POST',JSON.stringify({email:'fictional@synthetic.invalid',password:'fictional-test-value'})));
 expect(await response.json()).toEqual({active:true,role:'Finance',userId:'u',organizationId:'o',membershipVersion:2});expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
});
it('classifies a legacy reference through a scoped metadata lookup without returning financial data',async()=>{
 pipeline.reference.mockResolvedValue({owned:false,ownerUserId:null});
 const response=await GET(req('action=reference&id=original'));
 expect(await response.json()).toEqual({owned:false,ownerUserId:null});expect(pipeline.get).not.toHaveBeenCalled();
});
