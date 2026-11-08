import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { admit, budgetPolicy, budgetStore, clientAddress, DEFAULT_BUDGET, MemoryCounterStore, RedisRestCounterStore, type CounterStore } from '../../lib/server/ai/budget';

const T = Date.UTC(2026, 10, 2, 10, 0, 30);
const local = (store: CounterStore = new MemoryCounterStore(() => T)) => ({ store, secret: 'test-secret' });
const headers = (h: Record<string, string>) => new Headers(h);

describe('client identity for per-client limits', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('uses the first forwarded address and groups IPv6 by /64', () => {
        expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
        expect(clientAddress(headers({ 'x-forwarded-for': '2001:db8:abcd:12:1::5' }))).toBe('2001:db8:abcd:12::/64');
        expect(clientAddress(headers({ 'x-forwarded-for': '2001:db8:abcd:12:ffff:1:2:3' }))).toBe('2001:db8:abcd:12::/64');
        expect(clientAddress(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8:0:0::/64');
        expect(clientAddress(headers({ 'x-forwarded-for': '::ffff:198.51.100.4' }))).toBe('198.51.100.4');
        expect(clientAddress(headers({}))).toBe('unknown');
    });
    it('on Vercel trusts the platform header over a client-supplied X-Forwarded-For', () => {
        vi.stubEnv('VERCEL', '1');
        expect(clientAddress(headers({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('198.51.100.9');
    });
});

describe('store selection fails closed on hosted deployments', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('uses memory only off Vercel, requires an https durable store on Vercel', () => {
        vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', ''); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', ''); vi.stubEnv('VERCEL', '');
        expect(budgetStore()!.store.durable).toBe(false);
        vi.stubEnv('VERCEL', '1');
        expect(budgetStore()).toBeNull();
        vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', 'http://insecure.example'); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', 't');
        expect(budgetStore()).toBeNull();
        vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', 'https://example.upstash.io');
        expect(budgetStore()!.store.durable).toBe(true);
    });
    it('accepts the Upstash integration variables, one complete pair at a time, explicit names first', () => {
        for (const k of ['FINGENCE_AI_BUDGET_REST_URL', 'FINGENCE_AI_BUDGET_REST_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) vi.stubEnv(k, '');
        vi.stubEnv('VERCEL', '1');
        vi.stubEnv('KV_REST_API_URL', 'https://kv.example.upstash.io'); vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
        expect(budgetStore()).toMatchObject({ secret: 'kv-token', store: { durable: true } });
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://up.example.upstash.io'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'up-token');
        expect(budgetStore()).toMatchObject({ secret: 'up-token' });
        vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', 'https://explicit.example'); // incomplete pair: never mixed with another token
        expect(budgetStore()).toMatchObject({ secret: 'up-token' });
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'http://insecure.example');
        expect(budgetStore()).toBeNull(); // first complete pair is not https: fail closed, no fallback
    });
    it('accepts exactly one custom-prefixed integration store, with its read/write token only', () => {
        for (const k of Object.keys(process.env).filter(k => /KV_REST_API|UPSTASH|FINGENCE_AI_BUDGET_REST/.test(k))) vi.stubEnv(k, '');
        vi.stubEnv('VERCEL', '1');
        vi.stubEnv('UPSTASH_FOR_REDIS_FREE_KV_REST_API_URL', 'https://free.example.upstash.io');
        vi.stubEnv('UPSTASH_FOR_REDIS_FREE_KV_REST_API_READ_ONLY_TOKEN', 'read-only');
        expect(budgetStore()).toBeNull(); // a read-only token cannot hold a budget
        vi.stubEnv('UPSTASH_FOR_REDIS_FREE_KV_REST_API_TOKEN', 'read-write');
        expect(budgetStore()).toMatchObject({ secret: 'read-write', store: { durable: true } });
        vi.stubEnv('OTHER_STORE_KV_REST_API_URL', 'https://other.example.upstash.io'); vi.stubEnv('OTHER_STORE_KV_REST_API_TOKEN', 'other');
        expect(budgetStore()).toBeNull(); // two prefixed stores: ambiguous, fail closed
        vi.stubEnv('FINGENCE_AI_BUDGET_REST_URL', 'https://explicit.example'); vi.stubEnv('FINGENCE_AI_BUDGET_REST_TOKEN', 'explicit');
        expect(budgetStore()).toMatchObject({ secret: 'explicit' }); // explicit names resolve the ambiguity
    });
    it('clamps operator overrides', () => {
        vi.stubEnv('FINGENCE_AI_DAILY_BUDGET_USD', '1000'); vi.stubEnv('FINGENCE_AI_CLIENT_DAILY_CALLS', '-5');
        expect(budgetPolicy()).toMatchObject({ dailyUsd: 20, clientPerDay: DEFAULT_BUDGET.clientPerDay });
    });
});

describe('admission', () => {
    it('limits each client per minute without consuming the shared counters', async () => {
        const store = new MemoryCounterStore(() => T), add = vi.spyOn(store, 'add'), b = local(store);
        const results = [];
        for (let i = 0; i < 8; i++) results.push(await admit({ client: 'a', worstCaseUsd: 0.001 }, b, DEFAULT_BUDGET, T));
        expect(results.map(r => r.admitted)).toEqual([true, true, true, true, true, true, false, false]);
        expect(results[6]).toMatchObject({ code: 'CLIENT_RATE_LIMITED', status: 429, retryAfterSeconds: 30 });
        expect(add.mock.calls.filter(([k]) => k.startsWith('fg:ai:g:m:')).length).toBe(6);
        expect((await admit({ client: 'b', worstCaseUsd: 0.001 }, b, DEFAULT_BUDGET, T)).admitted).toBe(true);
    });
    it('caps all clients together per minute and per day', async () => {
        const b = local(), policy = { ...DEFAULT_BUDGET, globalPerMinute: 3, globalPerDay: 4 };
        const minute = [];
        for (let i = 0; i < 4; i++) minute.push((await admit({ client: `c${i}`, worstCaseUsd: 0 }, b, policy, T)).admitted);
        expect(minute).toEqual([true, true, true, false]);
        const later = T + 120_000;
        expect((await admit({ client: 'x', worstCaseUsd: 0 }, b, policy, later)).admitted).toBe(true); // 4th of the day
        expect(await admit({ client: 'y', worstCaseUsd: 0 }, b, policy, later)).toMatchObject({ code: 'DAILY_LIMIT', status: 429 });
    });
    it('reserves the worst case, settles to the measured cost and never exceeds the daily spend', async () => {
        const store = new MemoryCounterStore(() => T), b = local(store), policy = { ...DEFAULT_BUDGET, dailyUsd: 0.01 };
        let spent = 0, refused: unknown = null;
        for (let i = 0; i < 50 && !refused; i++) {
            const a = await admit({ client: `k${i}`, worstCaseUsd: 0.004 }, b, policy, T);
            if (!a.admitted) { refused = a; break; }
            spent += 0.0012; await a.settle(0.0012);
        }
        expect(refused).toMatchObject({ code: 'DAILY_BUDGET_EXHAUSTED', status: 429 });
        expect(spent).toBeLessThanOrEqual(0.01);
        expect(spent).toBeGreaterThan(0.006); // settlement returned the unused reservations
    });
    it('keeps the full reservation when the outcome is unknown and refunds a refused provider call', async () => {
        const store = new MemoryCounterStore(() => T), b = local(store), day = Math.floor(T / 86_400_000);
        const a = await admit({ client: 'z', worstCaseUsd: 0.004 }, b, DEFAULT_BUDGET, T);
        if (!a.admitted) throw new Error('expected admission');
        await a.settle(null);
        expect(await store.add(`fg:ai:usd:${day}`, 0, 1)).toBe(4000);
        const c = await admit({ client: 'z', worstCaseUsd: 0.004 }, b, DEFAULT_BUDGET, T);
        if (!c.admitted) throw new Error('expected admission');
        await c.settle(0);
        expect(await store.add(`fg:ai:usd:${day}`, 0, 1)).toBe(4000);
    });
    it('fails closed when the store is unavailable or not configured', async () => {
        const broken: CounterStore = { durable: true, add: async () => { throw new Error('down'); } };
        expect(await admit({ client: 'a', worstCaseUsd: 0 }, { store: broken, secret: 's' })).toMatchObject({ admitted: false, code: 'BUDGET_UNAVAILABLE', status: 503 });
        expect(await admit({ client: 'a', worstCaseUsd: 0 }, null)).toMatchObject({ admitted: false, code: 'BUDGET_UNAVAILABLE' });
    });
    it('stores only keyed hashes of client addresses', async () => {
        const store = new MemoryCounterStore(() => T), add = vi.spyOn(store, 'add');
        await admit({ client: '203.0.113.7', worstCaseUsd: 0 }, local(store), DEFAULT_BUDGET, T);
        expect(add.mock.calls.map(([k]) => k).join(' ')).not.toContain('203.0.113.7');
    });
});

describe('Redis REST store', () => {
    it('sends INCRBY and EXPIRE in one pipeline with the token and reads the counter', async () => {
        const transport = vi.fn(async () => Response.json([{ result: 3 }, { result: 1 }]));
        const store = new RedisRestCounterStore('https://example.upstash.io/', 'tok', transport as unknown as typeof fetch);
        expect(await store.add('k', 2, 60)).toBe(3);
        const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://example.upstash.io/pipeline');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body as string)).toEqual([['INCRBY', 'k', '2'], ['EXPIRE', 'k', '60']]);
        expect(init.redirect).toBe('error');
    });
    it('throws on an HTTP error or an unexpected reply', async () => {
        await expect(new RedisRestCounterStore('https://x', 't', (async () => new Response('', { status: 500 })) as unknown as typeof fetch).add('k', 1, 1)).rejects.toThrow(/BUDGET_STORE_HTTP_500/);
        await expect(new RedisRestCounterStore('https://x', 't', (async () => Response.json([{ error: 'WRONGTYPE' }])) as unknown as typeof fetch).add('k', 1, 1)).rejects.toThrow(/BUDGET_STORE_RESPONSE/);
    });
});
