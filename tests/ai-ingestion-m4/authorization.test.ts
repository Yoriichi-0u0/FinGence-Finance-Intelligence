import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
// All authorization records and transport doubles are confined to temporary test storage.
const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../lib/server/ai-ingestion/increment-03/providers', () => ({ GroqProvider03: class {
        propose = mock.send;
    } }));
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareAuthorizedGroq, readOwnerGrant, ownerGrantSchema } from '../../lib/server/ai-ingestion/m4/authorization';
import { extractTrustedEvidence } from '../../lib/server/ai-ingestion/v2-i1/persistence';
import { prepareRequest, policyHash, promptRevision } from '../../lib/ai-ingestion/increment-03/plan';
import { QuotaLedger, QUOTA } from '../../lib/server/ai-ingestion/increment-03/quota';
import type { M2InferenceContext } from '../../lib/server/ai-ingestion/m2/interpreter';
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); mock.send.mockReset(); for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true }); });
async function setup() {
    const folder = mkdtempSync(join(tmpdir(), 'm4-owner-test-'));
    dirs.push(folder);
    mkdirSync(join(folder, 'm4-authorizations'), { mode: 0o700 });
    const evidence = await extractTrustedEvidence(readFileSync('synthetic/m4/m401.csv'), 'source.csv'), request = prepareRequest(evidence), id = randomUUID(), now = Date.now();
    const context: M2InferenceContext = { operationId: randomUUID(), executionId: randomUUID(), sourceSha256: evidence.sourceId, token: 'test-only-not-a-session', principal: { user_id: randomUUID(), organization_id: randomUUID(), role: 'Finance', version: 1 } };
    const grant = { version: 'm4-owner-dispatch-v1', id, operationId: context.operationId, userId: context.principal.user_id, organizationId: context.principal.organization_id, membershipVersion: 1, sourceSha256: evidence.sourceId, promptHash: request.promptHash, policyHash, promptRevision, provider: 'LIVE_GROQ', model: 'openai/gpt-oss-20b', plan: 'GROQ_FREE', maxRequests: 1, maxUsd: 0, experimentCeilingUsd: 5, verifiedAt: now, expiresAt: now + 60000, checks: { ownerDispatch: true, syntheticOnly: true, freePlan: true, privacyRetention: true, modelAccess: true, accountQuotas: true }, limits: { ...QUOTA } };
    const file = join(folder, 'm4-authorizations', id + '.json'), save = () => writeFileSync(file, JSON.stringify(grant), { mode: 0o600 });
    save();
    for (const [key, value] of Object.entries({ NODE_ENV: 'development', VERCEL: '', FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED: '1', FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED: '1', FINGENCE_AI03_FREE_PLAN_CONFIRMED: '1', GROQ_API_KEY: 'test-transport-no-network' }))
        vi.stubEnv(key, value);
    return { folder, evidence, request, context, grant, file, save, id, now, prepare: () => prepareAuthorizedGroq(evidence, context, { folder, authorizationId: id, now: () => now }) };
}
it.each(['operationId', 'userId', 'organizationId', 'sourceSha256', 'promptHash', 'policyHash', 'membershipVersion', 'expiresAt'] as const)('rejects owner authorization with changed %s before transport', async (field) => { const s = await setup(); const changed = field === 'membershipVersion' ? 2 : field === 'expiresAt' ? s.now - 1 : field.endsWith('Hash') || field === 'sourceSha256' ? 'b'.repeat(64) : randomUUID(); Object.assign(s.grant, { [field]: changed }); s.save(); expect(() => s.prepare()).toThrow(); expect(mock.send).not.toHaveBeenCalled(); });
it('requires privacy, free-plan, model access and zero-dollar authorization, not reusable environment flags', async () => { const s = await setup(); expect(ownerGrantSchema.safeParse({ ...s.grant, maxUsd: 1 }).success).toBe(false); expect(ownerGrantSchema.safeParse({ ...s.grant, checks: { ...s.grant.checks, privacyRetention: false } }).success).toBe(false); vi.stubEnv('FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED', ''); expect(() => s.prepare()).toThrow('OWNER_AUTHORIZATION_REQUIRED'); });
it('retains a durable unknown/crash fence across service instances and clears only acknowledged own completion', async () => { const s = await setup(); mock.send.mockResolvedValue({ test: true }); const first = s.prepare(); await first.provider.propose(s.request); expect(() => s.prepare()).toThrow('PREVIOUS_DISPATCH_UNRESOLVED'); first.settle(false); expect(existsSync(join(s.folder, 'm4-dispatch.pending'))).toBe(true); first.settle(true); expect(existsSync(join(s.folder, 'm4-dispatch.pending'))).toBe(false); expect(mock.send).toHaveBeenCalledTimes(1); });
it('rejects symlinked or public authorization files', async () => { const s = await setup(); chmodSync(s.file, 0o644); expect(() => readOwnerGrant(s.folder, s.id)).toThrow(); chmodSync(s.file, 0o600); const id = randomUUID(); symlinkSync(s.file, join(s.folder, 'm4-authorizations', id + '.json')); expect(() => readOwnerGrant(s.folder, id)).toThrow(); });
it('blocks unresolved shared quota before constructing a dispatch', async () => { const s = await setup(), ledger = new QuotaLedger(s.folder); const id = ledger.reserve(10); ledger.finish(id, 'UNKNOWN'); expect(() => s.prepare()).toThrow('PREVIOUS_DISPATCH_UNRESOLVED'); expect(mock.send).not.toHaveBeenCalled(); });
it('enforces lower account-specific token/request limits atomically without raising original ceilings', () => { const folder = mkdtempSync(join(tmpdir(), 'm4-caps-')); dirs.push(folder); let now = Date.now(); const ledger = new QuotaLedger(folder, () => now), caps = { ...QUOTA, rpm: 1, tpm: 100, rpd: 2, tpd: 150, attempts: 3 }; expect(() => ledger.reserve(101, undefined, caps)).toThrow(); const a = ledger.reserve(80, undefined, caps); ledger.finish(a, 'COMPLETED', { inputTokens: 40, outputTokens: 20 }); expect(() => ledger.reserve(10, undefined, caps)).toThrow(/RPM|TPM/); now += 60001; ledger.finish(ledger.reserve(60, undefined, caps), 'COMPLETED', { inputTokens: 20, outputTokens: 20 }); now += 60001; expect(() => ledger.reserve(1, undefined, caps)).toThrow(/RPD/); expect(() => ledger.reserve(1, undefined, { ...QUOTA, tpm: 9000 })).toThrow(); expect(ledger.summary().attempts).toBe(2); });
