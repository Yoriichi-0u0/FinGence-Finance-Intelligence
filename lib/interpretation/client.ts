/** Browser-side interpreters: the server gateway (live) and replay of an earlier live proposal after reload. */
import { InterpreterUnavailable, type InterpretationResult, type LayoutInterpreter } from './contracts';

export type GatewayStatus = { available: true; provider: 'GROQ'; model: string; sends: string } | { available: false };
export async function gatewayStatus(): Promise<GatewayStatus> {
    try {
        const response = await fetch('/api/ai/interpret', { cache: 'no-store' });
        if (!response.ok) return { available: false };
        const body = await response.json() as Partial<Extract<GatewayStatus, { available: true }>>;
        return body.available === true && typeof body.model === 'string' ? { available: true, provider: 'GROQ', model: body.model, sends: String(body.sends ?? '') } : { available: false };
    } catch { return { available: false }; }
}

export const gatewayInterpreter: LayoutInterpreter = {
    async propose(evidence) {
        let response: Response;
        try { response = await fetch('/api/ai/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evidence }) }); }
        catch { throw new InterpreterUnavailable('GATEWAY_UNREACHABLE'); }
        const body = await response.json().catch(() => null) as (InterpretationResult & { code?: string }) | null;
        if (!response.ok || !body?.receipt) throw new InterpreterUnavailable(body?.code ?? `GATEWAY_HTTP_${response.status}`);
        return { proposal: body.proposal, receipt: body.receipt };
    },
};

/**
 * Re-checks an earlier live proposal for the same document bytes (by SHA-256) instead of calling the
 * model again; the gates still run in full. Unknown documents fall through to `fallback`, if any.
 */
export function replayInterpreter(saved: Record<string, InterpretationResult>, fallback: LayoutInterpreter | null): LayoutInterpreter {
    return {
        async propose(evidence) {
            const hit = saved[evidence.sha256];
            if (hit) return { proposal: hit.proposal, receipt: { ...hit.receipt, mode: 'REPLAYED' } };
            if (fallback) return fallback.propose(evidence);
            throw new InterpreterUnavailable('NOT_REPLAYABLE');
        },
    };
}
