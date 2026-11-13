import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { POST as previewPost } from '../../app/api/obsidian-demo/preview/route';
import { POST as sendPost } from '../../app/api/obsidian-demo/send/route';
import { GET as statusGet } from '../../app/api/obsidian-demo/status/route';

afterEach(() => vi.unstubAllEnvs());
const previewBody = JSON.stringify({ question: 'Where can I find account settings?' });
const sendBody = JSON.stringify({ previewId: '7f117ac3-005f-4f16-a0bd-bdf95b1c348a', payloadHash: 'a'.repeat(64), consent: true });
function post(path: string, body: string, host: string) {
    return new Request(`http://${host}${path}`, { method: 'POST', headers: { host, origin: `http://${host}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body });
}

describe('preview and send API route gates', () => {
    it.each([
        ['preview', previewPost, '/api/obsidian-demo/preview', previewBody],
        ['send', sendPost, '/api/obsidian-demo/send', sendBody],
    ] as const)('%s route refuses when FINGENCE_OBSIDIAN_DEMO is unset', async (_name, handler, path, body) => {
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '');
        const response = await handler(post(path, body, '127.0.0.1:3186'));
        const bodyText = await response.text();
        expect(response.status).toBe(404); expect(bodyText).toContain('OBSIDIAN_DEMO_DISABLED');
        process.stdout.write(`FLAG_OFF_ROUTE=${path} STATUS=${response.status} BODY=${bodyText}\n`);
    });

    it.each([
        ['preview', previewPost, '/api/obsidian-demo/preview', previewBody],
        ['send', sendPost, '/api/obsidian-demo/send', sendBody],
    ] as const)('%s route refuses a non-loopback caller when the demo flag is enabled', async (_name, handler, path, body) => {
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '1');
        const response = await handler(post(path, body, 'demo.example:3186'));
        expect(response.status).toBe(404); expect(await response.text()).toContain('OBSIDIAN_DEMO_LOOPBACK_REQUIRED');
    });
});

describe('chatbot and status demo gates', () => {
    it('keeps the pre-existing POC or synthetic chatbot when the Obsidian flag is unset', async () => {
        const { selectChatbotRuntime } = await import('../../lib/server/obsidian-demo/chatbot-mode');
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '');
        expect(selectChatbotRuntime({ poc: true, obsidian: false, synthetic: true })).toBe('poc');
        expect(selectChatbotRuntime({ poc: true, pocGroq: true, obsidian: false, synthetic: true })).toBe('poc-groq');
        expect(selectChatbotRuntime({ poc: false, obsidian: false, synthetic: true })).toBe('synthetic-demo');
        expect(selectChatbotRuntime({ poc: false, obsidian: false, synthetic: false })).toBe('not-found');
        process.stdout.write('FLAG_OFF_CHATBOT_ROUTING={"pocEnabled":"poc (existing workspace)","syntheticDemoEnabled":"synthetic-demo (existing public demo)","allModesDisabled":"not-found","obsidianDemoMounted":false}\n');
    });

    it.each([
        ['flag unset', '', '127.0.0.1:3186', 404],
        ['caller non-loopback', '1', 'demo.example:3186', 404],
    ])('keeps the status route unreachable when %s', async (_label, flag, host, expectedStatus) => {
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', flag);
        const response = await statusGet(new Request(`http://${host}/api/obsidian-demo/status`, { headers: { host, origin: `http://${host}` } }));
        expect(response.status).toBe(expectedStatus);
        if (_label === 'flag unset') process.stdout.write(`FLAG_OFF_ROUTE=/api/obsidian-demo/status STATUS=${response.status} BODY=${await response.text()}\n`);
    });
});

