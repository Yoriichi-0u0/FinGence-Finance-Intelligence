/** Browser-side interpreters: the server gateway (live) and replay of an earlier live proposal after reload. */
import { InterpreterUnavailable, retryKey, type InterpretationResult, type LayoutInterpreter } from './contracts';

export type GatewayStatus = { available: true; provider: 'GROQ'; model: string; sends: string } | { available: false };
export async function gatewayStatus(): Promise<GatewayStatus> {
    try {
        const response = await fetch('/api/ai/interpret', { cache: 'no-store' });
        if (!response.ok) return { available: false };
        const body = await response.json() as Partial<Extract<GatewayStatus, { available: true }>>;
        return body.available === true && typeof body.model === 'string' ? { available: true, provider: 'GROQ', model: body.model, sends: String(body.sends ?? '') } : { available: false };
    } catch { return { available: false }; }
}

type Fetch = typeof fetch;
async function callGateway(evidence: Parameters<LayoutInterpreter['propose']>[0], request: Fetch): Promise<InterpretationResult> {
    let response: Response;
    try { response = await request('/api/ai/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evidence }) }); }
    catch { throw new InterpreterUnavailable('GATEWAY_UNREACHABLE'); }
    const body = await response.json().catch(() => null) as (InterpretationResult & { code?: string; retryAfterSeconds?: number }) | null;
    if (!response.ok || !body?.receipt) throw new InterpreterUnavailable(body?.code ?? `GATEWAY_HTTP_${response.status}`, response.status === 429 ? body?.retryAfterSeconds : undefined);
    return { proposal: body.proposal, receipt: body.receipt };
}
/** Groq meters tokens over a rolling minute: a call is admitted again once the previous call has left that window. */
export const RATE_WINDOW_MS = 61_000;
/** The longest the browser waits before its single retry. */
export const MAX_RETRY_WAIT_MS = 65_000;
export type GatewayOptions = { request?: Fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; onWait?: (seconds: number | null) => void };
/**
 * At most ONE retry, and only after a refusal that was never billed: a provider 429 (refused before processing) or
 * the gateway's own budget refusal (before dispatch). The retry is a new request that the gateway budgets again. Any
 * other failure is final; the server itself never retries. The wait is the stated Retry-After, extended until the
 * previous successful call has left the provider's one-minute token window (a short Retry-After is often refused
 * again when two documents are interpreted back to back); a refusal that needs longer than 65 s is final.
 */
export function createGatewayInterpreter({ request = (...a) => fetch(...a), now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), onWait }: GatewayOptions = {}): LayoutInterpreter {
    let lastSuccess: number | null = null;
    const call = async (evidence: Parameters<LayoutInterpreter['propose']>[0]) => { const started = now(), result = await callGateway(evidence, request); lastSuccess = started; return result; };
    return {
        async propose(evidence) {
            try { return await call(evidence); }
            catch (error) {
                const stated = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
                if (stated === undefined) throw error;
                const wait = Math.max(stated * 1000 + 500, lastSuccess === null ? 0 : lastSuccess + RATE_WINDOW_MS - now());
                if (wait > MAX_RETRY_WAIT_MS) throw error;
                onWait?.(Math.ceil(wait / 1000));
                try { await sleep(wait); return await call(evidence); } finally { onWait?.(null); }
            }
        },
    };
}
export const gatewayInterpreter = createGatewayInterpreter();

/**
 * Re-checks an earlier live proposal for the same document bytes (by SHA-256) instead of calling the
 * model again; the gates still run in full. Unknown documents fall through to `fallback`, if any.
 */
export function replayInterpreter(saved: Record<string, InterpretationResult>, fallback: LayoutInterpreter | null): LayoutInterpreter {
    return {
        async propose(evidence) {
            // A second attempt replays the second proposal, so the same sequence of checks is re-run.
            const hit = saved[evidence.retry ? retryKey(evidence.sha256) : evidence.sha256];
            if (hit) return { proposal: hit.proposal, receipt: { ...hit.receipt, mode: 'REPLAYED' } };
            if (fallback) return fallback.propose(evidence);
            throw new InterpreterUnavailable('NOT_REPLAYABLE');
        },
    };
}
