import 'server-only';
import { evidenceSchema, InterpreterUnavailable, type LayoutInterpreter } from '../../interpretation/contracts';
import { createGatewayInterpreter } from '../../interpretation/client';
import { admit } from './budget';
import { proposeLayout, worstCaseUsd } from './groq-interpreter';

/**
 * One layout interpretation: a bounded evidence window admitted against the shared spend budget, forwarded once to
 * Groq with a strict JSON schema. Returns the UNTRUSTED proposal plus a usage receipt; the deterministic gates decide.
 * Shared by the browser gateway route and server processing jobs, so both spend from the same budget.
 */
export async function interpretEvidence(body: unknown, client: string): Promise<{ status: number; body: unknown }> {
    const evidence = evidenceSchema.safeParse((body as { evidence?: unknown } | null)?.evidence);
    if (!evidence.success) return { status: 400, body: { code: 'INVALID_EVIDENCE' } };
    const admission = await admit({ client, worstCaseUsd: worstCaseUsd(evidence.data) });
    if (!admission.admitted) return { status: admission.status, body: { code: admission.code, ...(admission.retryAfterSeconds ? { retryAfterSeconds: admission.retryAfterSeconds } : {}) } };
    try {
        const result = await proposeLayout(evidence.data);
        await admission.settle(result.receipt.estimatedUsd);
        return { status: 200, body: result };
    } catch (error) {
        const code = error instanceof InterpreterUnavailable ? error.code : 'INTERPRETER_FAILED';
        // A provider 429 is refused before processing and not billed; any other failure keeps its full reservation.
        await admission.settle(code === 'RATE_LIMITED' ? 0 : null);
        const retryAfterSeconds = error instanceof InterpreterUnavailable ? error.retryAfterSeconds : undefined;
        return code === 'RATE_LIMITED' ? { status: 429, body: { code, retryAfterSeconds: Math.ceil(retryAfterSeconds ?? 20) } } : { status: 502, body: { code } };
    }
}

/** The interpreter a server job uses: the same budgeted call and the same single, unbilled-refusal retry as the browser's. */
export function serverInterpreter(client: string): LayoutInterpreter {
    return createGatewayInterpreter({
        request: async (_url, init) => {
            const { status, body } = await interpretEvidence(JSON.parse(String(init?.body ?? 'null')), client);
            return Response.json(body, { status });
        },
    });
}
