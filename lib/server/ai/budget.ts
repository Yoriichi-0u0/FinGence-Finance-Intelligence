import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';

/**
 * Spend and abuse budget for the public AI gateway. Every limit is a fixed-window counter in a shared store, so
 * it holds across server instances; the in-memory store is for local development and tests only and is refused
 * on a hosted deployment. Admission happens before any provider call and FAILS CLOSED: if the store cannot be
 * reached, nothing is sent. The provider account's own limits remain an outer cap, not the plan.
 */
export interface CounterStore {
    readonly durable: boolean;
    /** Atomically adds `amount` to `key` (created at 0 with a `ttlSeconds` expiry) and returns the new value. */
    add(key: string, amount: number, ttlSeconds: number): Promise<number>;
}

export class MemoryCounterStore implements CounterStore {
    readonly durable = false;
    private readonly entries = new Map<string, { value: number; expires: number }>();
    constructor(private readonly now = () => Date.now()) {}
    async add(key: string, amount: number, ttlSeconds: number) {
        const t = this.now();
        if (this.entries.size > 10_000) for (const [k, e] of this.entries) if (e.expires <= t) this.entries.delete(k);
        let entry = this.entries.get(key);
        if (!entry || entry.expires <= t) { entry = { value: 0, expires: t + ttlSeconds * 1000 }; this.entries.set(key, entry); }
        entry.value += amount;
        return entry.value;
    }
}

/** Redis over HTTPS (Upstash REST protocol, as provisioned by Vercel's Redis integration): INCRBY + EXPIRE in one pipeline. */
export class RedisRestCounterStore implements CounterStore {
    readonly durable = true;
    constructor(private readonly url: string, private readonly token: string, private readonly transport: typeof fetch = fetch) {}
    async add(key: string, amount: number, ttlSeconds: number) {
        const response = await this.transport(`${this.url.replace(/\/+$/, '')}/pipeline`, {
            method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2_000),
            headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([['INCRBY', key, String(Math.trunc(amount))], ['EXPIRE', key, String(ttlSeconds)]]),
        });
        if (!response.ok) throw new Error(`BUDGET_STORE_HTTP_${response.status}`);
        const value = ((await response.json()) as { result?: unknown }[] | null)?.[0]?.result;
        if (typeof value !== 'number') throw new Error('BUDGET_STORE_RESPONSE');
        return value;
    }
}

export type BudgetPolicy = { clientPerMinute: number; clientPerDay: number; globalPerMinute: number; globalPerDay: number; dailyUsd: number };
export const DEFAULT_BUDGET: BudgetPolicy = { clientPerMinute: 6, clientPerDay: 30, globalPerMinute: 10, globalPerDay: 300, dailyUsd: 0.5 };
const bounded = (value: string | undefined, fallback: number, max: number) => { const n = Number(value); return value && Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback; };
export function budgetPolicy(): BudgetPolicy {
    return {
        ...DEFAULT_BUDGET,
        clientPerDay: Math.floor(bounded(process.env.FINGENCE_AI_CLIENT_DAILY_CALLS, DEFAULT_BUDGET.clientPerDay, 200)),
        globalPerDay: Math.floor(bounded(process.env.FINGENCE_AI_GLOBAL_DAILY_CALLS, DEFAULT_BUDGET.globalPerDay, 5_000)),
        dailyUsd: bounded(process.env.FINGENCE_AI_DAILY_BUDGET_USD, DEFAULT_BUDGET.dailyUsd, 20),
    };
}

let memory: MemoryCounterStore | null = null, memorySecret: string | null = null;
/** URL/token pairs, in precedence order: explicit FinGence names, then what Vercel's Upstash integration injects. */
const STORE_ENV = [['FINGENCE_AI_BUDGET_REST_URL', 'FINGENCE_AI_BUDGET_REST_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']] as const;
/**
 * The configured store: Redis REST from the first COMPLETE url+token pair (never a url from one pair with another's
 * token), https only; otherwise an in-process store, but only off Vercel. On a hosted deployment without a durable
 * store there is no gateway.
 */
export function budgetStore(): { store: CounterStore; secret: string } | null {
    const pair = STORE_ENV.find(([u, t]) => process.env[u] && process.env[t]);
    const url = pair ? process.env[pair[0]] : undefined, token = pair ? process.env[pair[1]] : undefined;
    if (url && token) return url.startsWith('https://') ? { store: new RedisRestCounterStore(url, token), secret: token } : null;
    if (process.env.VERCEL) return null;
    memory ??= new MemoryCounterStore(); memorySecret ??= randomBytes(32).toString('hex');
    return { store: memory, secret: memorySecret };
}

/** IPv6 clients are grouped by /64, the smallest block an end site is normally assigned, so rotation within it does not help. */
export function clientAddress(headers: Headers): string {
    const raw = (process.env.VERCEL ? headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') : null) ?? headers.get('x-forwarded-for') ?? 'unknown';
    const ip = raw.split(',')[0].trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, '');
    if (!ip.includes(':') || /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/^::ffff:/, '');
    const [head, tail = ''] = ip.split('::'), left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
    const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export type Admission = { admitted: true; reservedMicros: number; settle(actualUsd: number | null): Promise<void> } | { admitted: false; code: string; status: number; retryAfterSeconds?: number };
const MICROS = 1_000_000;

/**
 * Reserves a worst-case cost before the call and settles it with the measured cost afterwards. Order matters:
 * a client over its own limit never touches the shared counters, so one client cannot exhaust them. Counters
 * already incremented for a refused request are not refunded (fixed windows; refusals stay conservative).
 */
export async function admit(input: { client: string; worstCaseUsd: number }, budget = budgetStore(), policy = budgetPolicy(), now = Date.now()): Promise<Admission> {
    if (!budget) return { admitted: false, code: 'BUDGET_UNAVAILABLE', status: 503 };
    const { store, secret } = budget;
    const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
    const toMinute = 60 - Math.floor((now % 60_000) / 1000), toDay = Math.ceil((86_400_000 - (now % 86_400_000)) / 1000);
    const client = createHmac('sha256', secret).update(input.client).digest('hex').slice(0, 32);
    const reservedMicros = Math.ceil(input.worstCaseUsd * MICROS), spendKey = `fg:ai:usd:${day}`;
    try {
        if (await store.add(`fg:ai:c:${client}:m:${minute}`, 1, 120) > policy.clientPerMinute) return { admitted: false, code: 'CLIENT_RATE_LIMITED', status: 429, retryAfterSeconds: toMinute };
        if (await store.add(`fg:ai:c:${client}:d:${day}`, 1, 172_800) > policy.clientPerDay) return { admitted: false, code: 'CLIENT_DAILY_LIMIT', status: 429, retryAfterSeconds: toDay };
        if (await store.add(`fg:ai:g:m:${minute}`, 1, 120) > policy.globalPerMinute) return { admitted: false, code: 'RATE_LIMITED', status: 429, retryAfterSeconds: toMinute };
        if (await store.add(`fg:ai:g:d:${day}`, 1, 172_800) > policy.globalPerDay) return { admitted: false, code: 'DAILY_LIMIT', status: 429, retryAfterSeconds: toDay };
        if (await store.add(spendKey, reservedMicros, 172_800) > policy.dailyUsd * MICROS) {
            await store.add(spendKey, -reservedMicros, 172_800).catch(() => undefined);
            return { admitted: false, code: 'DAILY_BUDGET_EXHAUSTED', status: 429, retryAfterSeconds: toDay };
        }
    } catch {
        return { admitted: false, code: 'BUDGET_UNAVAILABLE', status: 503 };
    }
    return {
        admitted: true, reservedMicros,
        /** `null` keeps the whole reservation (the call may have been billed); a measured cost refunds the difference. */
        async settle(actualUsd) {
            if (actualUsd === null) return;
            const delta = Math.ceil(actualUsd * MICROS) - reservedMicros;
            if (delta) await store.add(spendKey, delta, 172_800).catch(() => undefined);
        },
    };
}
