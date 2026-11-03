import { describe, expect, it } from 'vitest';
import { createGatewayInterpreter } from '../../lib/interpretation/client';
import { InterpreterUnavailable, type LayoutEvidence } from '../../lib/interpretation/contracts';

const evidence = { sha256: 'a'.repeat(64), fileName: 'x.csv' } as LayoutEvidence;
const ok = () => new Response(JSON.stringify({ proposal: { layout: { role: 'UNSUPPORTED' } }, receipt: { model: 'm' } }), { status: 200 });
const refused = (code: string, retryAfterSeconds?: number) => new Response(JSON.stringify({ code, retryAfterSeconds }), { status: 429 });
/** A fake clock and transport: `sleep` advances time; each request may take `latency` ms. */
function harness(responses: (() => Response)[], latency = 0) {
    let t = 0; const sent: number[] = [], waits: (number | null)[] = [], slept: number[] = [];
    const interpreter = createGatewayInterpreter({
        now: () => t, sleep: async ms => { slept.push(ms); t += ms; }, onWait: s => waits.push(s),
        request: async () => { sent.push(t); t += latency; const next = responses.shift(); if (!next) throw Error('unexpected request'); return next(); },
    });
    return { interpreter, sent, waits, slept, advance: (ms: number) => { t += ms; } };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'resolved'; } catch (e) { return e instanceof InterpreterUnavailable ? e.code : String(e); } };

describe('the browser retries an unbilled refusal once, after the provider minute has passed', () => {
    it('a refusal right after a successful call waits until that call leaves the one-minute window', async () => {
        const h = harness([ok, () => refused('RATE_LIMITED', 8), ok], 3800);
        await h.interpreter.propose(evidence); // first document: dispatched at t=0, done at 3.8 s
        await h.interpreter.propose(evidence); // second document: refused, then retried once
        expect(h.sent).toEqual([0, 3800, 61_000]);
        expect(h.waits).toEqual([54, null]);
    });
    it('without an earlier call the stated Retry-After is enough', async () => {
        const h = harness([() => refused('RATE_LIMITED', 8), ok]);
        expect(await code(h.interpreter.propose(evidence))).toBe('resolved');
        expect(h.slept).toEqual([8500]);
    });
    it('a long stated Retry-After still wins over the window', async () => {
        const h = harness([ok, () => refused('CLIENT_RATE_LIMITED', 64), ok]);
        await h.interpreter.propose(evidence); h.advance(30_000);
        await h.interpreter.propose(evidence);
        expect(h.slept).toEqual([64_500]);
    });
    it.each([
        ['a daily limit', () => refused('DAILY_LIMIT', 3600)],
        ['a provider failure', () => new Response(JSON.stringify({ code: 'PROVIDER_ERROR' }), { status: 502 })],
        ['a refusal without Retry-After', () => refused('RATE_LIMITED')],
    ])('%s is final: no retry', async (_, response) => {
        const h = harness([response]);
        expect(await code(h.interpreter.propose(evidence))).not.toBe('resolved');
        expect([h.sent.length, h.slept]).toEqual([1, []]);
    });
    it('retries at most once', async () => {
        const h = harness([() => refused('RATE_LIMITED', 5), () => refused('RATE_LIMITED', 5)]);
        expect(await code(h.interpreter.propose(evidence))).toBe('RATE_LIMITED');
        expect(h.sent.length).toBe(2);
        expect(h.waits).toEqual([6, null]);
    });
    it('an unreachable gateway is reported, not retried', async () => {
        const interpreter = createGatewayInterpreter({ request: async () => { throw Error('offline'); }, sleep: async () => { throw Error('must not wait'); } });
        expect(await code(interpreter.propose(evidence))).toBe('GATEWAY_UNREACHABLE');
    });
});
